# 冰脊 · PX-06，2076

北极星方向的冰岩世界。PX-06 的前轮掀起冰壳，六轮越过斜向冰脊，车顶探头在刹停时抬起。最后一镜将近墩、远墩和峡谷横梁对齐成 π。全片为 1920 × 1080、30 fps、240 帧的静音 H.264。

| Blender 帧（从 1 开始） | 镜头 |
| --- | --- |
| 1–42 | 轮齿下的冰晶泛白，裂纹先于冰壳翻起。冰壳有上下两个面、粗糙断口和薄边。 |
| 43–135 | 从车头一侧低位跟拍。第 118 帧是铭牌海报。 |
| 136–219 | 车体刹停回弹，探头上仰，摄影机沿弧线升高。 |
| 220–240 | 透视对齐，锁定 21 帧。 |

## 编辑与预演

使用 Blender 5.2.1 LTS。打开 `desktop/build/startup/polaris-rover.blend` 可以直接拖动时间线或按 F12 渲染。文件保存时停在第 118 帧。轮组、悬架、探头和摄影机均使用普通关键帧。`PIORA_Relic` 集合中的三个独立网格保持静止，生成脚本和图标 SVG 均嵌入工程。

```powershell
blender -b -t 6 --python-exit-code 1 --python scripts/blender/piora_intro.py -- --mode FRAME --quality PREVIEW --format PNG_SEQUENCE --out .verification/ice-ridge
blender -b -t 6 --python-exit-code 1 --python scripts/blender/piora_intro.py -- --mode ANIMATION --quality PREVIEW --format MP4 --out .verification/ice-ridge
```

预演使用 480 × 270 和完整 8 秒的路线、地形和机位。脚本在每次运行时新建一个 `run_…` 目录。开场看接触斑和轮缘上的赭色检修标记，跟拍看地面的相对运动和车身滞后，升镜看各构件在远山前的相对位移。

## 生成正式资产

```powershell
blender -b -t 6 --python-exit-code 1 --python scripts/blender/piora_intro.py -- --mode ANIMATION --quality FINAL --format PNG_SEQUENCE --out .verification/ice-ridge
$run = (Get-ChildItem .verification/ice-ridge -Directory -Filter 'run_*' | Sort-Object Name -Descending | Select-Object -First 1).FullName
blender -b "$run/piora_polaris_2076.blend" --python-exit-code 1 --python scripts/blender/verify_intro.py
node scripts/encode-startup-video.mjs ffmpeg $run
```

正式成片使用 Cycles。生成器优先选择可用的 GPU。编码器检查 PNG 序列，写入 BT.709、yuv420p、fast-start MP4，从该 MP4 解码第 118 帧作为 JPG 海报，并记录 MP4、JPG、压缩 `.blend` 的字节数和 SHA-256。可以在编码命令末尾指定暂存目录。

轮胎颗粒、金属加工纹和陶瓷涂层使用物体坐标，随轮组和车身移动。冰面沿风向铺开磨砂霜层，冰壳的透光面与磨粗的断口分别着色。遗迹的紫青冰脉在背光侧露出，暖光集中在横梁左端。

## 复核

```powershell
python scripts/blender/test_numerics.py
node --test lib/desktop-startup-visual.test.mjs lib/desktop-startup-loading.test.mjs lib/startup-media-assets.test.mjs
npm run preview:startup
```

打开 `http://127.0.0.1:31043/` 可查看 Piora 桌面启动文档中的成片及右上角跳过控件。版本记忆、启动放行与 10 秒看门狗由 Electron 主进程负责。

`verify_intro.py` 在保存的场景中对六轮逐帧检查，读取轮齿网格与地面三角形的间距，并用轮心位移核对转角。它还检查铭牌和序列号的间隔、跟拍取景、停车位置、结尾机位和遗迹网格相对 SVG 的投影误差。最终视觉验收使用编码后的视频。
