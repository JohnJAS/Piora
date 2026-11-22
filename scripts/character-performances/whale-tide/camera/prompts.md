# 晴汐桌边的定镜动作

制作输出为 1920 × 1080。行走、道具与地面坐标保持在 1536 × 864 的原画构图中，最后一次采样才换算成输出像素。固定露台与透明角色各自烘焙，静态画来自 `public/themes/character-backgrounds/whale-tide.webp`。

| 制作素材 | 用途 |
| --- | --- |
| `stage-repair.webp` | 从输出 x=850 起补全头发、衣裙和鲸尾挡住的天空、海岸和栏杆。茶点与桌布固定在这里。 |
| `native-pose.webp` | 同一位置的原画前景。它与空景叠合可逐像素还原直接放到 1080p 的原画。 |
| `cup-hd.mp4` | 53 张经过线条还原的放杯关键画，每张的颜色和覆盖率各为 1000 × 932。正向和反向的光流会追踪它们之间的笔画和轮廓，可在任意时间取样。 |
| `cup.webp` | 放在桌面上的独立茶杯。走路或转身后，茶杯的位置仍与放杯结束时一致。 |
| `standing.webp` | 放杯结束与走步开始共用的双手合拢立姿。 |
| `ink-guides.mp4` | 49 张正面、侧面、背面及行礼参考。每张左侧保存 384 × 320 的参考画，右侧保存 768 × 640 的局部线纹修正。相邻参考经过光流对齐和颜色核对，眼睛的原始渐变另行保留。 |
| `anime-detail.onnx` | 离线合成时在 OpenCV DNN 中执行的 2 倍 Anime4K Medium 网络。源计算图的卷积与激活已转换成 ONNX，子像素重排与原图合成在 Python 中执行。 |

## 补景、放杯和回位

以原画生成同景别的空露台参考图，补出人物遮挡的地平线、栏杆和桌沿，保留右侧原有茶点。参考图与 1672 × 941 的原画配准后再恢复边缘透明度。独立放杯关键画依次呈现提杯、双手接杯、伸手放杯、空手撤回与站稳。杯身随手保持直立，落桌后位于甜点前方。开头沿眉眼、下巴和帽沿对齐原画头部；反向播放同一组动作即可重新取杯。

## 烘焙与来源

安装 Python、NumPy、带 DNN 的 OpenCV 与 FFmpeg，可在已有姿态目录上运行 `python scripts/bake-character-walk.py --poses <目录>`。输入目录下应包含与当前时间线一致的 `gait/` 和 `center/`。重新生成姿态还需要 SciPy 和 RIFE v4.6。制作素材随项目保存，桌面端播放已经烘焙的结果。

`anime-detail.onnx` 转换自 bloc97 的 Anime4K 3.2 着色器，采用 MIT 许可证。原始算子的版权与许可保存在同目录的 `anime-detail-LICENSE.txt`。[Anime4K 原始着色器](https://github.com/bloc97/Anime4K/blob/28535a4aff3deb55707a36c2f2d05009e0cb7fb3/glsl/Upscale/Anime4K_Upscale_CNN_x2_M.glsl)

绘制放杯关键画及各朝向参考的线纹时，使用 Real-ESRGAN 里的 `realesr-animevideov3` 2 倍模型进行离线修复。修复结果按原画亮度配准并限幅，以保留裙边、握杯手指和虹膜的原始颜色与层次。项目中保存处理后的图像。[Real-ESRGAN 动画模型说明](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/anime_video_model.md)
