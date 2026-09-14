# Bundled offline speech

SenseVoiceSmall INT8 by Alibaba / FunAudioLLM; ONNX conversion by Fangjun Kuang
(csukuangfj). The model name and authorship remain unchanged.

- Converted model: https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07
- Model SHA-256: `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`
- Tokens SHA-256: `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`
- The conversion's LICENSE refers to the FunASR model terms. `MODEL_LICENSE`
  contains the upstream FunASR Model Open Source License Agreement 1.1, retrieved
  from https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE on 2026-09-14.
- `LICENSE` preserves the separate SenseVoice toolkit MIT license (Git blob
  `803405cb8d259ab594e5bd7d1e407abf10df6860`); it does not replace the model terms.
- sherpa-onnx 1.13.6 by the sherpa-onnx authors, Apache-2.0:
  https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.6
  (`SHERPA-LICENSE`, Git blob `d645695673349e3947e8e5ae42332d0ac3164cd7`).
- Native runtime archives and their hashes are pinned in
  `lib/speech-pack-catalog.ts`. Published runtime files are copied intact.
- The Windows archive includes ONNX Runtime 1.27.1 (verified from the DLL's
  product version). The npm archive omits its license texts, so they are
  supplied separately as `ONNXRUNTIME-LICENSE` and `ONNXRUNTIME-NOTICES` from
  https://github.com/microsoft/onnxruntime/tree/v1.27.1 (Git blobs
  `48bc6bb4996ac924359e8e28b9ae88970e5ed3fc` and
  `fbd9f9a95f6013d8ecaef81e02b0033e5882a675`).

The build downloads and verifies the resources; installed Windows applications
load these local files without fetching models or executing package installers.
