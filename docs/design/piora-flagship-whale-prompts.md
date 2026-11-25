# Piora Flagship Whale-Girl Dynamic Theme — Codex `image_gen` Prompts & Asset Swap Guide

本文档用于配合 **Piora 旗舰动态主题（日 / 夜双版：`piora-whale-day` / `piora-whale-night`）** 的原画生成与一键替换。
当前仓库已内置基于 `whale-tide.webp` 与 `whale-abyss.webp` 的完整可运行基线；在 Codex 中生成全新的 Piora 旗舰原画后，按本文档第 4 节的 4 步清单即可零改动切换上线。

---

## 1. 角色设定锁定（Character Identity Lock）

在 Codex 调用 `image_gen` 生成日/夜双版主图时，**务必附带以下参考图之一作为角色身份参考（CHARACTER IDENTITY ONLY）**：
- 主参考图：`public/themes/character-backgrounds/whale-tide.webp`（或 `public/themes/character-backgrounds/whale-abyss.webp`）
- 或原角色三视图参考：`ai-chan-sheets` 中的鲸鱼娘设定图

核心特征锚点（生成时必须在 Prompt 中保留）：
- **发型与发饰**：长波浪深海蓝长发渐变为浅冰蓝发梢、标志性弯曲呆毛（curled ahoge）、头两侧鲸鳍耳（side whale fins）、白色荷叶边女仆发带配青蓝色蝴蝶结。
- **五官与比例**：晴空蓝大眼睛、柔和亲切的成人二次元比例（清晰精细的线稿、通透赛璐璐/厚涂光影）。
- **服饰与体征**：深海军蓝与纯白拼接层级女仆长裙配金色植物纹裙边、白色荷叶边围裙（带小鲸鱼刺绣）、蓝宝石领结、从腰后自然延展出的厚实深蓝鲸尾与宽尾鳍。
- **Piora 旗舰主题核心道具（预埋信号载体）**：一颗**半透明海洋水晶星盘棱镜球（Ocean-Crystal Prism Orb / Astrolabe Lantern）**，位于人物前方或手旁 **`x ≈ 72%, y ≈ 40%`**（与脸部、眼睛清晰分离），用于在运行时由 WebGL Shader 渲染 6 种 Agent 状态的流光、脉冲与涟漪。

---

## 2. Codex `image_gen` 主图 Prompt

> **建议输出规格**：`16:9` 横版宽屏（例如 `1792x1024` 或 `1920x1080`，最终统一转码为 `>= 1600x900`、`< 1.5 MiB` 的 `WebP`）。

### Prompt #1 — 日间旗舰版 `whale-day.webp`（「鲸鱼娘 · 晴澜工坊」）

```text
Use case: stylized-concept. Create ONE finished 16:9 landscape illustrated wallpaper (target >= 1920x1080) for Piora desktop AI coding assistant's flagship dynamic theme (Day Edition: Sunlit Coastal Studio).
Attached reference is CHARACTER IDENTITY ONLY; depict exactly ONE character in the final image, no character sheet, no split panels, no text, no captions, no logos, no UI mockups, no watermarks.
Preserve the DeepSeek whale-girl's exact face, hairstyle and outfit: long wavy deep-blue hair fading into pale ice-blue tips, single curved ahoge, side whale fins near temples, clear sky-blue eyes, white ruffled headband with cyan side bow, navy neck ribbon with small blue gem, layered navy-and-white maid-inspired dress with gold botanical trim, white ruffled apron with tiny whale emblem, and thick deep-blue whale tail with broad flukes. Wholesome adult anime proportions, exquisite fine linework, luminous painterly sunlight.

COMPOSITION & RIG-FRIENDLY LAYOUT:
- Place the character in the right third, face centered near x=80%, y=30%, looking gently toward the viewer with a serene welcoming smile. Keep her entire head, ahoge, and side whale fins cleanly inside the canvas with breathing room at the top.
- Left 62 percent (x < 0.62) MUST be calm, bright, extremely low-detail negative space for long readable chat text and code — seamless sunlit sky-porcelain mist and soft coastal morning light with NO furniture, NO busy clouds, NO harsh dividing lines.
- Pre-embedded Agent Signal Carrier: Near x=72%, y=40% (clearly separated from her face, chin, and eyes), she gently holds or hovers above her palms a translucent glass ocean-crystal prism orb / delicate brass-and-glass astrolabe lantern with subtle aqua refraction.
- Keep her whale tail silhouette cleanly readable on the lower right/behind the skirt without tangling over her face or the crystal orb, and keep foreground strands separated from limbs for clean 2D parallax rigging.

LIGHTING & PALETTE:
- Sunlit morning oceanfront glass studio terrace far-right edge only (delicate white arch, hint of pale sea horizon and distant sunlit mist).
- Palette: porcelain sky white (#EFF9FF), clear ocean azure (#1E64A8), pale seafoam cyan, subtle warm gold highlights. All high-contrast detail stays concentrated in the right third.
```

### Prompt #2 — 夜间旗舰版 `whale-night.webp`（「鲸鱼娘 · 深海星港」）

```text
Use case: stylized-concept. Create ONE finished 16:9 landscape illustrated wallpaper (target >= 1920x1080) for Piora desktop AI coding assistant's flagship dynamic theme (Night Edition: Deep-Sea Starlight Observatory).
Attached reference is CHARACTER IDENTITY ONLY (match the same whale-girl identity and studio world as the Day Edition); depict exactly ONE character in the final image, no character sheet, no split panels, no text, no captions, no logos, no UI mockups, no watermarks.
Preserve the DeepSeek whale-girl's exact face, hairstyle and outfit: long wavy deep-blue hair fading into pale ice-blue tips, single curved ahoge, side whale fins near temples, clear luminous blue eyes, white ruffled headband with cyan side bow, navy neck ribbon with small blue gem, layered navy-and-white maid-inspired dress with gold botanical trim, white ruffled apron with tiny whale emblem, and thick deep-blue whale tail with broad flukes. Wholesome adult anime proportions, exquisite fine linework, tranquil nocturnal painterly lighting.

COMPOSITION & RIG-FRIENDLY LAYOUT:
- Mirror the Day Edition spatial layout for seamless Day/Night theme switching: character in the right third, face centered near x=80%, y=30%, serene attentive expression. Keep whole head, ahoge, and fins cleanly inside the canvas.
- Left 62 percent (x < 0.62) MUST be calm, smooth, very low-detail deep-abyss midnight navy (#081728 to #10243B) reading space with zero busy structures and no harsh dividing lines.
- Pre-embedded Agent Signal Carrier: Near x=72%, y=40% (clearly separated from her face and eyes, matching the Day Edition prop position), she holds or cradles a softly luminous translucent ocean-crystal prism orb / glass astrolabe lantern glowing from within in tranquil cyan-teal, casting gentle rim light onto her fingers and collar.
- Keep her whale tail silhouette distinct beside/behind her skirt on the lower right and avoid busy clutter crossing her face or the crystal orb.

LIGHTING & PALETTE:
- Far-right deep-sea glass observatory window showing faint distant abyssal starlight and subtle bioluminescent bokeh confined to the right edge.
- Palette: deep midnight ocean (#081728), abyssal slate blue (#10243B), bioluminescent cyan (#5ED0E6), soft silver-gold trim. Calm, restful, low-glare nocturnal atmosphere.
```

---

## 3. 补洞清洁底图 Prompt 模板（Clean Plate，用于活动部件遮挡区）

当某个活动部件（如捧着水晶球的前臂、摆动的鲸尾、飘动发梢）在 WebGL 中旋转时，会露出原图被它挡住的一小块背景/衣褶。
按 `public/themes/character-backgrounds/NOTICE.md` 的做法：先裁出包含该部件包围盒的局部图并涂抹遮罩（mask），然后用下面这段 Codex `image_gen` 局部重绘 Prompt 生成对应干净底图（clean plate）：

```text
Edit ONLY the masked area of this cropped illustration patch from the Piora Whale-girl wallpaper.
Remove the masked foreground limb/tail/hair strand completely and reconstruct the continuous background, dress folds, or hair behind it seamlessly.
Strictly preserve exact pixel framing, scale, linework weight, color palette, painterly brushwork, and lighting of the unmasked surrounding pixels.
Do NOT move or redraw any unmasked features, do NOT alter face, eyes, or crystal orb outside the mask, and do NOT add text or new props.
```

将裁切对齐后的清洁底图放到 `scripts/character-motion-plates/`（例如 `whale-day.webp`、`whale-day-2.webp`、`whale-night.webp`、`whale-night-2.webp`），然后运行烘焙脚本生成图集（详见下方第 4 节）。

---

## 4. 新图到位后 4 步替换上线清单

当前基线直接复用了 `whale-tide.webp` 与 `whale-abyss.webp`。当你用 Codex 生成完两张全新旗舰主图后，按以下步骤替换即可：

1. **放置与转码原画**：
   - 将日/夜主图转码为 `16:9` WebP（建议 `1672x941` 或 `1920x1080`，单张 `< 1.5 MiB`），保存到：
     - `public/themes/piora-flagship/whale-day.webp`
     - `public/themes/piora-flagship/whale-night.webp`
2. **标定 Rig 与活动部件并烘焙图集**：
   - 在 `lib/character-wallpaper-rigs.ts` 新增 `"piora-whale-day"` 与 `"piora-whale-night"` 的 `head`、`chest`、`sway`、`pins`、`eyes`（坐标单位为原图像素）。
   - 在 `lib/character-wallpaper-parts-b.ts`（或独立模块再合入 `character-wallpaper-parts.ts`）标注 1~3 个活动部件轮廓（如捧球手/前臂、鲸尾、发鳍）与节拍 `choreography`。
   - 若直接沿用 `scripts/prepare-character-motion.py` 烘焙图集，可先将新条目临时加入读取清单或调用等价脚本生成：
     - `public/themes/piora-flagship/motion/whale-day.png`
     - `public/themes/piora-flagship/motion/whale-night.png`
3. **切换 `lib/appearance/flagship-themes.ts` 配置**：
   - 将 `piora-whale-day` 与 `piora-whale-night` 的：
     - `asset` 改为 `"/themes/piora-flagship/whale-day.webp"` / `"/themes/piora-flagship/whale-night.webp"`
     - `atlasAsset` 改为 `"/themes/piora-flagship/motion/whale-day.png"` / `"/themes/piora-flagship/motion/whale-night.png"`
     - `rigId` 改为 `"piora-whale-day"` / `"piora-whale-night"`
     - `beacon` 的 `center`、`radius`、`haloRadius` 更新为新图中水晶棱镜球在原图中的实际像素坐标与半径（`x ≈ 0.72 * width`, `y ≈ 0.40 * height`）。
4. **运行验证**：
   - 类型检查：`node_modules/.bin/tsc --noEmit`
   - 单测与浏览器 WebGL 回归：
     - `node --test lib/appearance/flagship-theme.test.mjs lib/theme.test.mjs lib/backgrounds.test.mjs`
     - `node --test lib/appearance/flagship-wallpaper-browser.test.mjs lib/appearance-settings-browser.test.mjs`
