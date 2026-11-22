# Character theme artwork / 角色主题素材署名

These images are generated fan interpretations, not official brand mascots.
The application's MIT code license does not grant rights to these character assets.

The `motion/` atlases are derived from the corresponding bundled paintings.
Their alpha channels trace the animated parts. Their color channels reconstruct
the small areas revealed when a part moves. Each atlas shares its source
painting's attribution and terms as listed below. The animation uses the
painted poses and the AI character traits in lmy414's sheets.

Clean plates in `scripts/character-motion-plates/` contain painted details
normally hidden by the moving parts. The built-in image generator was given
a crop of the original with the part masked, and asked to preserve framing,
color, lighting and line work while continuing the drawing behind the mask.
For example, removing Claude's raised forearm reveals her copper hair and
neckline, removing GPT's crystal-bearing hand reveals the wing membrane, and
removing Kimi's flute reveals the star-patterned cape and blouse. These edits
are registered to the original artwork. Only exposed pixels appear in use.
Plate names match the wallpaper; a suffix such as `-2` selects its second
moving part. Run `python scripts/prepare-character-motion.py` to bake the
atlases from the registered plates, outlines and original paintings.

### 晴汐的露台行礼

`performances/whale-tide-stage.webp` 保留举杯壁纸的近景构图，补绘人物原先遮挡的露台。`performances/whale-tide-actor.webm` 单独保存带透明通道的人物与茶杯。播放器叠放两层，采用相同的尺寸和裁切位置。双向走步、转身和提裙礼使用以原画为参考的补绘素材，沿用原壁纸的署名和 CC BY-NC-SA 4.0 改编条款。[原画、补绘提示词和制作底稿](../../../scripts/character-performances/whale-tide/)

制作脚本 `scripts/bake-character-walk.py` 导出 1920 × 1080 的露台底图和每秒 60 帧的无声角色动画。去程的双手交叠取形于接待站姿，再配上两次小步换重心。返程的肩、肘和腕依次跟随步子，转圈使用单独绘制的背身和裙摆姿势。[体前叠手示范](https://www.cdp.edu.cn/__local/E/BE/B0/09D2517B1B1250971E6C49CE9A5_182DFE2F_29E30F.pdf) · [接待步态示范](https://www.youtube.com/watch?v=S4BZ4UtQqfU) · [走步动画教程](https://www.animationmentor.com/blog/tutorial-animating-human-walk-cycle/) · [英国皇家芭蕾舞团的定点转头示范](https://www.youtube.com/watch?v=88bsYB9i6Mc) · [RIFE 插帧工具](https://github.com/nihui/rife-ncnn-vulkan)

## AI characters (17 images)

- Original character designs: **ZipZipPipe（胖次狐）**, https://space.bilibili.com/4168597
- Supplemental character sheets: **lmy414**, https://github.com/lmy414/ai-chan-sheets
- Reference repository used to generate the original wallpapers, with individual commits and paths in `provenance.json`: https://github.com/JohnJAS/ai-chan-sheets
- Reference sheet license: **CC BY-NC-SA 4.0**, https://creativecommons.org/licenses/by-nc-sa/4.0/
- These generated adaptations are provided under **CC BY-NC-SA 4.0** for the new adaptation contribution, subject to the retained rights in the original character designs. Attribution, noncommercial use and share-alike conditions apply. No endorsement or trademark license is asserted.
- Changes: a new scene and pose for each wallpaper, with the character sheet used for identity and costume reference; generated with Codex built-in image_gen on 2026-10-30, then encoded as WebP. Exact reference commit, file, URL and generation prompt are recorded in `provenance.json`.
- The upstream license explicitly excludes its `参考原图/` directory; those original illustrations were not copied into this asset directory. The repository's supplemental-sheet license does not provide a separate license to the original character designs.

## Kitty humanizations (3 images)

`kitty-ribbon.webp`, `kitty-strawberry.webp`, `kitty-moon.webp` are generated, unofficial Hello Kitty humanizations, not part of ai-chan-sheets. Hello Kitty is a Sanrio character. No rights to the underlying character or trademark, or brand endorsement, are granted by Piora's MIT license or by the AI sheet license.

## Red-scarf Doubao meme adaptation (1 image, 2026-10-31)

`seed-scarf.webp` is an unofficial wallpaper adaptation of the short-haired, red-scarf, drooling Doubao meme explicitly selected by the user. The reference was found at https://pbs.twimg.com/media/HNwGyrabgAA6FjD.jpg via an image-search result associated with https://x.com/holegots . This discovery account is not asserted to be the original artist. The original artist and source-image license have not been verified. Character, trademark and source-image rights remain with their respective owners; neither the code's MIT license nor the ai-chan-sheets CC license grants those rights. Generated with the built-in image_gen tool, then encoded as WebP; the source hash and exact prompt are recorded separately in `provenance.json`.

红围巾发呆版使用用户确认的网络梗图作为形象参考，保留短发、红围巾、白上衣和呆萌表情，扩展为左侧留白的横向壁纸。它不是紫发 Seed 娘设定的变体，也不是官方发布的主题。来源账号不等同于原作者；原图作者和授权未核实，相关权利单独保留。

## 原有角色系列说明

AI 角色原始形象作者为 ZipZipPipe，参考补全设定作者为 lmy414；本组参考该设定重新生成场景原画。17 张 AI 角色改编图的新改编部分按 CC BY-NC-SA 4.0 保留署名、非商业及相同方式共享条件，原始角色权利仍归原权利人。3 张 Kitty 拟人图单独保留角色权利说明。全部素材与程序代码的 MIT 许可分开记录。
