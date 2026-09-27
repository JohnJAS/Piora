import { TestBridge } from '../bridge/TestBridge';
@Entry
@Component
struct TestIndex {
  @State runId: string = '';
  @StorageLink('appTestPairing') pairing: string = 'not-paired';
  @StorageLink('appTestResult') result: string = 'not-run';
  build() {
    Column({ space: 16 }) {
      Text('DEBUG PCM bridge — does not cover the microphone or speech recognition')
      TextInput({ text: this.runId, placeholder: 'Task/run identifier' }).onChange(value => { this.runId = value; })
      Button('Pair once for 2 minutes').onClick(() => {
        try { this.pairing = TestBridge.pair(this.runId); this.result = 'ready'; }
        catch (error) { this.result = 'invalid-run'; }
      })
      Text(this.pairing).id('app-test-pairing').copyOption(CopyOptions.LocalDevice)
      Text(this.result).id('app-test-result')
    }.padding(24)
  }
}
