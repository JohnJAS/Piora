type Region = readonly [x: number, y: number, radiusX: number, radiusY: number];
export type Eye = readonly [leftX: number, leftY: number, rightX: number, rightY: number, upper: number, lower: number];

export interface CharacterWallpaperRig {
  head: Region;
  shoulders: Region;
  sway: readonly [Region, Region];
  eyes: readonly [Eye] | readonly [Eye, Eye];
}

// Coordinates are measured in the original WebP pixels. Give the face its own
// pivot and place sway regions on the loose hair, sleeves, or scarf of each pose.
const rigs: Record<string, CharacterWallpaperRig> = {
  "character-claude-autumn": {
    head: [1211, 185, 150, 188],
    shoulders: [1257, 401, 225, 202],
    sway: [[1000, 531, 219, 190], [1490, 405, 165, 148]],
    eyes: [[1160, 194, 1194, 187, 8, 11], [1212, 172, 1250, 155, 9, 13]],
  },
  "character-claude-lamp": {
    head: [1310, 213, 170, 167],
    shoulders: [1251, 449, 213, 172],
    sway: [[954, 624, 207, 199], [1430, 376, 104, 138]],
    eyes: [[1262, 237, 1308, 229, 9, 11], [1331, 223, 1366, 198, 12, 11]],
  },
  "character-claude-paper": {
    head: [1231, 194, 156, 151],
    shoulders: [1272, 422, 192, 195],
    sway: [[879, 751, 300, 184], [1506, 604, 200, 237]],
    eyes: [[1180, 200, 1215, 191, 8, 11], [1232, 185, 1268, 168, 9, 12]],
  },
  "character-ernie-garden": {
    head: [1254, 172, 139, 145],
    shoulders: [1260, 352, 170, 159],
    sway: [[960, 633, 150, 163], [1483, 502, 112, 193]],
    eyes: [[1213, 182, 1241, 175, 8, 10], [1254, 165, 1288, 149, 9, 11]],
  },
  "character-gemini-prism": {
    head: [1251, 238, 170, 167],
    shoulders: [1290, 452, 195, 143],
    sway: [[989, 554, 162, 189], [1534, 416, 178, 165]],
    eyes: [[1207, 265, 1248, 253, 16, 13], [1269, 225, 1311, 204, 16, 18]],
  },
  "character-glm-ink": {
    head: [1233, 242, 174, 170],
    shoulders: [1256, 469, 229, 150],
    sway: [[1048, 712, 119, 123], [1559, 514, 134, 171]],
    eyes: [[1190, 259, 1226, 245, 10, 12], [1243, 222, 1286, 202, 12, 15]],
  },
  "character-gpt-cloud": {
    head: [1273, 218, 167, 180],
    shoulders: [1280, 429, 173, 147],
    sway: [[1090, 440, 104, 139], [1469, 523, 163, 212]],
    eyes: [[1221, 239, 1258, 228, 11, 11], [1283, 208, 1323, 191, 11, 13]],
  },
  "character-gpt-ivory": {
    head: [1252, 203, 165, 174],
    shoulders: [1229, 409, 204, 165],
    sway: [[970, 638, 165, 183], [1507, 567, 160, 184]],
    eyes: [[1192, 192, 1225, 199, 11, 8], [1253, 201, 1294, 211, 11, 10]],
  },
  "character-gpt-orbit": {
    head: [1298, 235, 182, 196],
    shoulders: [1300, 433, 214, 205],
    sway: [[946, 666, 264, 180], [1513, 438, 156, 161]],
    eyes: [[1247, 259, 1271, 257, 11, 11], [1288, 238, 1323, 223, 10, 12]],
  },
  "character-grok-eclipse": {
    head: [1258, 242, 171, 184],
    shoulders: [1266, 440, 193, 189],
    sway: [[958, 615, 168, 164], [1536, 477, 174, 165]],
    eyes: [[1199, 260, 1241, 251, 13, 12], [1272, 232, 1315, 215, 12, 15]],
  },
  "character-kimi-moon": {
    head: [1227, 219, 164, 169],
    shoulders: [1253, 428, 215, 171],
    sway: [[858, 617, 187, 157], [1501, 485, 139, 158]],
    eyes: [[1177, 241, 1215, 229, 14, 14], [1241, 210, 1280, 191, 12, 17]],
  },
  "character-kitty-moon": {
    head: [1333, 228, 199, 200],
    shoulders: [1372, 441, 241, 174],
    sway: [[1186, 331, 107, 118], [1491, 322, 91, 102]],
    eyes: [[1263, 231, 1302, 220, 13, 12], [1336, 195, 1378, 170, 12, 16]],
  },
  "character-kitty-ribbon": {
    head: [1316, 173, 154, 162],
    shoulders: [1341, 396, 173, 206],
    sway: [[1217, 273, 97, 100], [1482, 791, 124, 161]],
    eyes: [[1257, 179, 1289, 170, 13, 9], [1314, 150, 1351, 135, 10, 12]],
  },
  "character-kitty-strawberry": {
    head: [1343, 222, 202, 201],
    shoulders: [1357, 479, 225, 199],
    sway: [[1217, 330, 108, 129], [1052, 741, 107, 169]],
    eyes: [[1268, 238, 1312, 225, 13, 12], [1350, 201, 1399, 177, 12, 16]],
  },
  "character-minimax-coral": {
    head: [1242, 236, 209, 218],
    shoulders: [1238, 463, 231, 201],
    sway: [[1075, 359, 113, 103], [1409, 315, 115, 124]],
    eyes: [[1161, 274, 1211, 257, 28, 17], [1258, 225, 1316, 210, 21, 21]],
  },
  "character-qwen-porcelain": {
    head: [1273, 216, 179, 192],
    shoulders: [1292, 457, 195, 183],
    sway: [[922, 646, 191, 186], [1470, 451, 112, 158]],
    eyes: [[1216, 240, 1257, 226, 16, 15], [1288, 201, 1333, 180, 13, 17]],
  },
  "character-seed-scarf": {
    head: [1321, 377, 296, 279],
    shoulders: [1289, 741, 302, 263],
    sway: [[1059, 484, 112, 124], [1170, 797, 119, 136]],
    eyes: [[1179, 335, 1268, 361, 25, 24], [1375, 390, 1472, 409, 30, 23]],
  },
  "character-seed-soda": {
    head: [1259, 224, 199, 196],
    shoulders: [1351, 425, 229, 161],
    sway: [[1518, 445, 144, 179], [1535, 603, 136, 121]],
    eyes: [[1183, 247, 1229, 230, 18, 17], [1263, 205, 1316, 186, 19, 23]],
  },
  "character-whale-abyss": {
    head: [1236, 251, 172, 171],
    shoulders: [1260, 434, 196, 177],
    sway: [[1039, 577, 98, 105], [1516, 464, 166, 172]],
    eyes: [[1189, 274, 1231, 261, 19, 17], [1260, 235, 1310, 220, 16, 20]],
  },
  "character-whale-rice": {
    head: [1240, 340, 271, 279],
    shoulders: [1215, 533, 186, 147],
    sway: [[953, 605, 134, 117], [1482, 617, 178, 158]],
    // The left eyelid is already closed in the character's winking pose.
    eyes: [[1251, 345, 1330, 330, 24, 19]],
  },
  "character-whale-tide": {
    head: [1266, 221, 166, 188],
    shoulders: [1290, 429, 225, 184],
    sway: [[1034, 561, 166, 153], [1500, 572, 160, 170]],
    eyes: [[1214, 230, 1255, 215, 19, 17], [1283, 199, 1332, 185, 16, 22]],
  },
};

const rigsByPreset = new Map(Object.entries(rigs));

export function getCharacterWallpaperRig(presetId: string | null | undefined): CharacterWallpaperRig | undefined {
  return presetId ? rigsByPreset.get(presetId) : undefined;
}
