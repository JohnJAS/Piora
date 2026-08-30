"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

export type HarmonyFrameStatus = "idle" | "loading" | "live" | "error";

export interface HarmonyLiveFrame {
  serial: string;
  generation: number;
  revision: number;
  width: number;
  height: number;
}

interface UseHarmonyLiveFrameOptions {
  active: boolean;
  enabled: boolean;
  paused?: boolean;
  serial: string;
  generation?: number;
  fallbackError: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

const PACKET_HEADER_BYTES = 8;
const MAX_PACKET_BYTES = 64 * 1024 * 1024;
const VIDEO_CONFIG = 0x02;
const VIDEO_FRAME = 0x03;
const H264 = 0;
const RAW_RGBA = 1;
const JPEG = 2;

type StreamConfig = {
  codec: number;
  width: number;
  height: number;
  fps: number;
  sps: Uint8Array;
  pps: Uint8Array;
};

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
  return typeof payload.error === "string" ? payload.error : payload.error?.message || `Request failed (${response.status})`;
}

function startCodedUnit(unit: Uint8Array): Uint8Array {
  if ((unit[0] === 0 && unit[1] === 0 && unit[2] === 1)
    || (unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1)) return unit;
  const result = new Uint8Array(unit.length + 4);
  result.set([0, 0, 0, 1]);
  result.set(unit, 4);
  return result;
}

function h264Codec(sps: Uint8Array): string {
  const unit = startCodedUnit(sps);
  const offset = unit[2] === 1 ? 3 : 4;
  const profile = unit[offset + 1] ?? 0x42;
  const compatibility = unit[offset + 2] ?? 0xe0;
  const level = unit[offset + 3] ?? 0x1f;
  return `avc1.${[profile, compatibility, level].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function keyframeData(config: StreamConfig, frame: Uint8Array): Uint8Array {
  const sps = startCodedUnit(config.sps);
  const pps = startCodedUnit(config.pps);
  const nal = startCodedUnit(frame);
  const result = new Uint8Array(sps.length + pps.length + nal.length);
  result.set(sps, 0);
  result.set(pps, sps.length);
  result.set(nal, sps.length + pps.length);
  return result;
}

function parseConfig(payload: Uint8Array): StreamConfig {
  if (payload.length < 13) throw new Error("Harmony video configuration is truncated");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const config: StreamConfig = {
    codec: view.getUint8(0),
    width: view.getUint32(1, false),
    height: view.getUint32(5, false),
    fps: view.getUint32(9, false),
    sps: new Uint8Array(),
    pps: new Uint8Array(),
  };
  if (config.width < 1 || config.height < 1 || config.width > 16_384 || config.height > 16_384) {
    throw new Error("Harmony video dimensions are invalid");
  }
  if (config.codec !== H264) return config;
  if (payload.length < 17) throw new Error("Harmony H.264 configuration is truncated");
  let offset = 13;
  const spsLength = view.getUint16(offset, false);
  offset += 2;
  if (offset + spsLength + 2 > payload.length) throw new Error("Harmony H.264 SPS is truncated");
  config.sps = payload.slice(offset, offset + spsLength);
  offset += spsLength;
  const ppsLength = view.getUint16(offset, false);
  offset += 2;
  if (offset + ppsLength > payload.length) throw new Error("Harmony H.264 PPS is truncated");
  config.pps = payload.slice(offset, offset + ppsLength);
  return config;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = window.setTimeout(done, milliseconds);
    const abort = () => done();
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolveDelay();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function useHarmonyLiveFrame(options: UseHarmonyLiveFrameOptions) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<HarmonyFrameStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<HarmonyLiveFrame | null>(null);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!options.active || !options.enabled || !options.serial || options.generation === undefined) {
      setFrame(null);
      setStatus("idle");
      setError(null);
      return;
    }
    if (options.paused) return;

    const lifecycle = new AbortController();
    let disposed = false;
    let decoder: VideoDecoder | undefined;
    let config: StreamConfig | undefined;
    let revision = 0;
    let firstKeyframe = false;
    let failures = 0;
    let hasFrame = false;
    let jpegChain = Promise.resolve();
    setFrame(null);
    setStatus("loading");
    setError(null);
    const initialCanvas = options.canvasRef.current;
    initialCanvas?.getContext("2d")?.clearRect(0, 0, initialCanvas.width, initialCanvas.height);

    const publishFrame = (width: number, height: number) => {
      if (disposed) return;
      revision += 1;
      if (!hasFrame) {
        hasFrame = true;
        setFrame({ serial: options.serial, generation: options.generation!, revision, width, height });
      }
      setStatus("live");
      setError(null);
      failures = 0;
    };

    const drawVideoFrame = (videoFrame: VideoFrame) => {
      try {
        const canvas = options.canvasRef.current;
        if (!canvas || disposed) return;
        const width = videoFrame.displayWidth || videoFrame.codedWidth;
        const height = videoFrame.displayHeight || videoFrame.codedHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.getContext("2d", { alpha: false })?.drawImage(videoFrame, 0, 0, width, height);
        publishFrame(width, height);
      } finally {
        videoFrame.close();
      }
    };

    const configureDecoder = async (next: StreamConfig) => {
      decoder?.close();
      decoder = undefined;
      firstKeyframe = false;
      if (next.codec !== H264) return;
      if (!("VideoDecoder" in window)) throw new Error("This Piora runtime does not support hardware video decoding");
      const decoderConfig: VideoDecoderConfig = {
        codec: h264Codec(next.sps),
        codedWidth: next.width,
        codedHeight: next.height,
        optimizeForLatency: true,
        hardwareAcceleration: "prefer-hardware",
      };
      const support = await VideoDecoder.isConfigSupported(decoderConfig);
      if (!support.supported) throw new Error(`H.264 decoder ${decoderConfig.codec} is unavailable`);
      decoder = new VideoDecoder({
        output: drawVideoFrame,
        error: (decodeError) => {
          if (!disposed) {
            setStatus("error");
            setError(decodeError.message || options.fallbackError);
          }
        },
      });
      decoder.configure(support.config ?? decoderConfig);
    };

    const drawJpeg = async (bytes: Uint8Array, next: StreamConfig) => {
      const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/jpeg" }));
      try {
        const canvas = options.canvasRef.current;
        if (!canvas || disposed) return;
        if (canvas.width !== next.width || canvas.height !== next.height) {
          canvas.width = next.width;
          canvas.height = next.height;
        }
        canvas.getContext("2d", { alpha: false })?.drawImage(bitmap, 0, 0, next.width, next.height);
        publishFrame(next.width, next.height);
      } finally {
        bitmap.close();
      }
    };

    const drawRgba = (bytes: Uint8Array, next: StreamConfig) => {
      if (bytes.length < 8) throw new Error("Harmony RGBA frame is truncated");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(0, false);
      const height = view.getUint32(4, false);
      if (width !== next.width || height !== next.height || bytes.length !== 8 + width * height * 4) {
        throw new Error("Harmony RGBA frame dimensions are invalid");
      }
      const canvas = options.canvasRef.current;
      if (!canvas || disposed) return;
      canvas.width = width;
      canvas.height = height;
      const pixels = new Uint8ClampedArray(bytes.slice(8).buffer as ArrayBuffer);
      canvas.getContext("2d", { alpha: false })?.putImageData(new ImageData(pixels, width, height), 0, 0);
      publishFrame(width, height);
    };

    const processPacket = async (type: number, payload: Uint8Array) => {
      if (type === VIDEO_CONFIG) {
        config = parseConfig(payload);
        await configureDecoder(config);
        return;
      }
      if (type !== VIDEO_FRAME || !config || payload.length < 9) return;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const keyframe = (view.getUint8(0) & 1) !== 0;
      const timestamp = Number(view.getBigUint64(1, false));
      const data = payload.subarray(9);
      if (config.codec === H264) {
        if (!decoder || decoder.state !== "configured") return;
        if (!firstKeyframe && !keyframe) return;
        if (decoder.decodeQueueSize > 8 && !keyframe) return;
        const chunkData = keyframe ? keyframeData(config, data) : startCodedUnit(data);
        decoder.decode(new EncodedVideoChunk({ type: keyframe ? "key" : "delta", timestamp, data: chunkData }));
        if (keyframe) firstKeyframe = true;
      } else if (config.codec === JPEG) {
        jpegChain = jpegChain.then(() => drawJpeg(data, config!));
        await jpegChain;
      } else if (config.codec === RAW_RGBA) {
        drawRgba(data, config);
      } else {
        throw new Error(`Unsupported Harmony video codec ${config.codec}`);
      }
    };

    const consume = async (body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader();
      let pending = new Uint8Array();
      while (!lifecycle.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Harmony video connection closed");
        if (!value?.length) continue;
        if (pending.length + value.length > MAX_PACKET_BYTES + PACKET_HEADER_BYTES) {
          throw new Error("Harmony video stream exceeded its buffer limit");
        }
        const combined = new Uint8Array(pending.length + value.length);
        combined.set(pending);
        combined.set(value, pending.length);
        pending = combined;
        let offset = 0;
        while (pending.length - offset >= PACKET_HEADER_BYTES) {
          const view = new DataView(pending.buffer, pending.byteOffset + offset, pending.length - offset);
          const type = view.getUint32(0, false);
          const length = view.getUint32(4, false);
          if (length > MAX_PACKET_BYTES) throw new Error("Harmony video packet is too large");
          if (pending.length - offset < PACKET_HEADER_BYTES + length) break;
          const payload = pending.slice(offset + PACKET_HEADER_BYTES, offset + PACKET_HEADER_BYTES + length);
          offset += PACKET_HEADER_BYTES + length;
          await processPacket(type, payload);
        }
        pending = offset === 0 ? pending : pending.slice(offset);
      }
    };

    const connect = async () => {
      while (!lifecycle.signal.aborted) {
        setStatus(hasFrame ? "live" : "loading");
        try {
          const response = await fetch(`/api/harmony/video?serial=${encodeURIComponent(options.serial)}`, {
            cache: "no-store",
            headers: { Accept: "application/vnd.piora.harmony-stream" },
            signal: lifecycle.signal,
          });
          if (!response.ok) throw new Error(await responseError(response));
          if (!response.body) throw new Error("Harmony video response has no stream body");
          await consume(response.body);
        } catch (streamError) {
          if (lifecycle.signal.aborted || disposed) return;
          failures += 1;
          setStatus("error");
          setError(streamError instanceof Error ? streamError.message : options.fallbackError);
          decoder?.close();
          decoder = undefined;
          config = undefined;
          firstKeyframe = false;
          await delay(Math.min(8_000, 750 * (2 ** Math.min(failures, 3))), lifecycle.signal);
        }
      }
    };

    void connect();
    return () => {
      disposed = true;
      lifecycle.abort();
      decoder?.close();
      void jpegChain.catch(() => undefined);
    };
  }, [options.active, options.canvasRef, options.enabled, options.fallbackError, options.generation, options.paused, options.serial, refreshKey]);

  return { frame, status, error, refresh };
}
