"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  containsAudibleSpeech,
  encodePcm16Wav,
  MAX_VOICE_RECORDING_MS,
  mergeAudioChunks,
  resampleAudio,
} from "@/lib/voice-audio";

export type LocalDictationPhase = "idle" | "starting" | "recording" | "transcribing";
export type LocalDictationError = "permission" | "microphone" | "no-speech" | "generic";

interface LocalDictationOptions {
  language: "zh" | "en";
  onTranscript: (text: string) => void;
}

interface AudioCapture {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
  chunks: Float32Array[];
  sampleRate: number;
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function releaseCapture(capture: AudioCapture | null): void {
  if (!capture) return;
  capture.processor.onaudioprocess = null;
  try { capture.source.disconnect(); } catch { /* Already disconnected. */ }
  try { capture.processor.disconnect(); } catch { /* Already disconnected. */ }
  try { capture.silentGain.disconnect(); } catch { /* Already disconnected. */ }
  for (const track of capture.stream.getTracks()) track.stop();
  void capture.context.close().catch(() => {});
}

export function useLocalDictation({ language, onTranscript }: LocalDictationOptions) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<LocalDictationPhase>("idle");
  const [error, setError] = useState<LocalDictationError | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<LocalDictationPhase>("idle");
  const mountedRef = useRef(true);
  const onTranscriptRef = useRef(onTranscript);
  const languageRef = useRef(language);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  onTranscriptRef.current = onTranscript;
  languageRef.current = language;

  const setCurrentPhase = useCallback((next: LocalDictationPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    requestRef.current?.abort();
    requestRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    releaseCapture(capture);
    setCurrentPhase("idle");
  }, [clearTimer, setCurrentPhase]);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture || (phaseRef.current !== "recording" && phaseRef.current !== "starting")) return;
    clearTimer();
    captureRef.current = null;
    releaseCapture(capture);

    const samples = mergeAudioChunks(capture.chunks);
    if (samples.length === 0) {
      setCurrentPhase("idle");
      if (mountedRef.current) setError("no-speech");
      return;
    }

    if (!containsAudibleSpeech(samples, capture.sampleRate)) {
      setCurrentPhase("idle");
      if (mountedRef.current) setError("no-speech");
      return;
    }

    setCurrentPhase("transcribing");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const pcm = resampleAudio(samples, capture.sampleRate);
      const wav = encodePcm16Wav(pcm);
      const wavBuffer = new ArrayBuffer(wav.byteLength);
      new Uint8Array(wavBuffer).set(wav);
      const response = await fetch(`/api/speech/transcribe?language=${languageRef.current}`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: wavBuffer,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { text?: unknown };
      if (!response.ok) throw new Error("Local transcription failed");
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) {
        if (mountedRef.current) setError("no-speech");
      } else {
        if (mountedRef.current) setError(null);
        onTranscriptRef.current(text);
      }
    } catch {
      if (!controller.signal.aborted && mountedRef.current) setError("generic");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setCurrentPhase("idle");
    }
  }, [clearTimer, setCurrentPhase]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      setAvailable(false);
      return;
    }
    setError(null);
    setCurrentPhase("starting");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if ((phaseRef.current as LocalDictationPhase) !== "starting") {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      context = new AudioContextClass();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      const chunks: Float32Array[] = [];
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      captureRef.current = {
        stream,
        context,
        source,
        processor,
        silentGain,
        chunks,
        sampleRate: context.sampleRate,
      };
      setCurrentPhase("recording");
      timerRef.current = setTimeout(() => { void stopRef.current(); }, MAX_VOICE_RECORDING_MS);
    } catch (captureError) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (context) void context.close().catch(() => {});
      const name = captureError instanceof DOMException ? captureError.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setError("permission");
      else if (name === "NotFoundError" || name === "NotReadableError") setError("microphone");
      else setError("generic");
      setCurrentPhase("idle");
    }
  }, [setCurrentPhase]);

  const toggle = useCallback(async () => {
    if (phaseRef.current === "recording" || phaseRef.current === "starting") await stop();
    else if (phaseRef.current === "idle") await start();
  }, [start, stop]);

  const clearError = useCallback(() => setError(null), []);

  const refreshAvailability = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/speech/transcribe", { cache: "no-store", signal });
    if (!response.ok) return;
    const payload = await response.json() as { available?: unknown };
    const nextAvailable = payload.available === true;
    setAvailable(nextAvailable);
    if (!nextAvailable && phaseRef.current !== "idle") cancel();
  }, [cancel]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void refreshAvailability(controller.signal).catch(() => {}); };
    refresh();
    window.addEventListener("piora:speech-settings-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("piora:speech-settings-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAvailability]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      requestRef.current?.abort();
      releaseCapture(captureRef.current);
      captureRef.current = null;
    };
  }, [clearTimer]);

  return {
    available,
    supported: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(getAudioContextConstructor()),
    phase,
    error,
    toggle,
    stop,
    cancel,
    clearError,
  };
}
