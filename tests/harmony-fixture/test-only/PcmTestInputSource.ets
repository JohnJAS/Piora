import { AudioInputSource } from '../audio/AudioInputSource';
export class PcmTestInputSource implements AudioInputSource {
  private pcm: Uint8Array;
  constructor(pcm: Uint8Array) { this.pcm = pcm; }
  async start(onFrame: (data: ArrayBuffer) => void): Promise<void> { const buffer = new ArrayBuffer(this.pcm.length); new Uint8Array(buffer).set(this.pcm); onFrame(buffer); }
  async stop(): Promise<void> { this.pcm = new Uint8Array(0); }
}
