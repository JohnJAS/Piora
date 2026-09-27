import { audio } from '@kit.AudioKit';

export interface AudioInputSource {
  start(onFrame: (data: ArrayBuffer) => void): Promise<void>;
  stop(): Promise<void>;
}
export class MicrophoneSource implements AudioInputSource {
  private capturer?: audio.AudioCapturer;
  async start(onFrame: (data: ArrayBuffer) => void): Promise<void> {
    if (this.capturer) throw new Error('Already recording');
    try {
    this.capturer = await audio.createAudioCapturer({
      streamInfo: { samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000, channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW },
      capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 }
    });
    this.capturer.on('readData', onFrame);
    await this.capturer.start();
    } catch (error) { await this.stop(); throw new Error('Microphone initialization failed'); }
  }
  async stop(): Promise<void> {
    const current = this.capturer; this.capturer = undefined;
    if (!current) return;
    try { if (current.state === audio.AudioState.STATE_RUNNING) await current.stop(); }
    finally { await current.release(); }
  }
}
