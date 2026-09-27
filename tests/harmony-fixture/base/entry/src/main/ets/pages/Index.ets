import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { MicrophoneSource } from '../audio/AudioInputSource';

function listItems(): number[] {
  const items: number[] = [];
  for (let index = 0; index < 80; index++) items.push(index);
  return items;
}

@Entry
@Component
struct Index {
  @State status: string = 'ready';
  @State bytes: number = 0;
  @State input: string = '';
  private microphone: MicrophoneSource = new MicrophoneSource();
  private timer: number = -1;
  private items: number[] = listItems();
  aboutToDisappear(): void { clearTimeout(this.timer); this.microphone.stop(); }
  async listen(): Promise<void> {
    try {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const grant = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.MICROPHONE']);
    if (grant.authResults.some(result => result !== 0)) { this.status = 'permission-denied'; return; }
    this.bytes = 0;
      await this.microphone.start((data: ArrayBuffer) => { this.bytes += data.byteLength; });
      this.status = 'listening';
      this.timer = setTimeout(() => { this.microphone.stop().then(() => { this.status = 'captured'; }); }, 3000);
    } catch (error) { await this.microphone.stop(); this.status = 'capture-failed'; }
  }
  build() {
    Column({ space: 12 }) {
      Text('Piora microphone fixture').id('fixture-title')
      Text(this.status).id('capture-status')
      Text(this.bytes.toString()).id('capture-bytes')
      Button('Record 3 seconds').id('voice-entry').onClick(() => { this.listen(); })
      TextInput({ text: this.input, placeholder: '中文输入测试' }).id('text-input').onChange(value => { this.input = value; })
      Text(this.input).id('text-result')
      List() { ForEach(this.items, (index: number) => {
        ListItem() { Text('Item ' + index.toString()).id('item-' + index.toString()).height(48) }
      }, (index: number) => index.toString()) }.height(300).width('100%').id('long-list')
    }.padding(24).width('100%')
  }
}
