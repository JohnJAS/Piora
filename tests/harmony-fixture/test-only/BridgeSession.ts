export interface PcmEnvelope {
  runId: string;
  deviceInstance: string;
  token: string;
  expiresAt: number;
  sampleRate: number;
  channels: number;
}
/** Copied byte-for-byte to ArkTS by the fixture generator; never in production. */
export class BridgeSession {
  private consumed: boolean = false;
  private runId: string;
  private instance: string;
  private secret: string;
  private expiresAt: number;
  constructor(runId: string, instance: string, secret: string, expiresAt: number) {
    this.runId = runId; this.instance = instance; this.secret = secret; this.expiresAt = expiresAt;
  }
  consume(packet: PcmEnvelope, pcm: Uint8Array, now: number): void {
    if (this.consumed || now >= this.expiresAt || packet.expiresAt !== this.expiresAt || packet.runId !== this.runId || packet.deviceInstance !== this.instance || !this.secret || packet.token.length !== this.secret.length) throw new Error('App-test authorization invalid');
    let difference: number = 0;
    for (let index: number = 0; index < this.secret.length; index++) difference |= packet.token.charCodeAt(index) ^ this.secret.charCodeAt(index);
    if (difference !== 0 || packet.sampleRate !== 16000 || packet.channels !== 1 || pcm.length < 2 || pcm.length > 8000 || pcm.length % 2 !== 0) throw new Error('App-test packet invalid');
    this.consumed = true;
    this.secret = '';
  }
}
