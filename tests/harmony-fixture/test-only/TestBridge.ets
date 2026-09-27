import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { BridgeSession, PcmEnvelope } from './BridgeSession';
import { PcmTestInputSource } from './PcmTestInputSource';
interface TestPacket extends PcmEnvelope { pcmBase64: string }
export class TestBridge {
  private static session?: BridgeSession;
  static pair(runId: string): string {
    if (!/^[A-Za-z0-9:._-]{1,160}$/.test(runId)) throw new Error('Enter a task/run identifier');
    const instance = util.generateRandomUUID(true), token = util.generateRandomUUID(true), expiresAt = Date.now() + 120000;
    TestBridge.session = new BridgeSession(runId, instance, token, expiresAt);
    return JSON.stringify({ runId: runId, deviceInstance: instance, token: token, expiresAt: expiresAt });
  }
  static async receive(encoded: string): Promise<void> {
    if (!TestBridge.session || encoded.length > 20000) throw new Error('Pair this debug app first');
    const decoder = new util.Base64Helper();
    const packet = JSON.parse(new util.TextDecoder().decodeToString(decoder.decodeSync(encoded))) as TestPacket;
    const pcm = decoder.decodeSync(packet.pcmBase64);
    TestBridge.session.consume(packet, pcm, Date.now());
    TestBridge.session = undefined;
    try {
    const source = new PcmTestInputSource(pcm), digest = cryptoFramework.createMd('SHA256');
    let received = new Uint8Array(0);
    try { await source.start((buffer: ArrayBuffer) => { received = new Uint8Array(buffer); }); }
    finally { await source.stop(); }
    await digest.update({ data: received });
    const hash = (await digest.digest()).data;
    AppStorage.setOrCreate('appTestResult', 'app-test:' + Array.from(hash).map(value => value.toString(16).padStart(2, '0')).join(''));
    AppStorage.setOrCreate('appTestPairing', 'consumed');
    } catch (error) { throw new Error('PCM processing failed'); }
  }
}
