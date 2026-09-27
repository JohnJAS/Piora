import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { TestBridge } from '../bridge/TestBridge';
export default class EntryAbility extends UIAbility {
  onWindowStageCreate(stage: window.WindowStage): void { stage.loadContent('pages/TestIndex').catch(() => { console.error('Fixture UI failed to load'); }); }
  onNewWant(want: Want): void {
    const packet = want.parameters?.pioraPcmPacket;
    if (typeof packet === 'string') TestBridge.receive(packet).catch(() => { AppStorage.setOrCreate('appTestResult', 'rejected'); });
  }
}
