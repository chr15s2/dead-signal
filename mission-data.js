/**
 * First Contact: an authored coastal village rather than a random arena.
 * All coordinates are world pixels. Mission records are immutable; each world
 * receives fresh, destructible cover and fresh decoration objects.
 * Original content, MIT licensed; see the project LICENSE.
 */
function freezeData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

export const FIRST_CONTACT = freezeData({
  width: 2800,
  height: 2200,
  start: {x: 220, y: 1950},
  extraction: {x: 2550, y: 200, r: 86},
  entry: {
    id: 'entry', name: 'Village checkpoint',
    zone: {x: 760, y: 1700, r: 150}, radius: 330,
    enemies: [
      {type: 'soldier', x: 690, y: 1630},
      {type: 'soldier', x: 870, y: 1600},
      {type: 'soldier', x: 930, y: 1750},
      {type: 'soldier', x: 700, y: 1810},
      {type: 'soldier', x: 990, y: 1715},
      {type: 'soldier', x: 830, y: 1450},
    ],
  },
  rescues: [
    {
      id: 'clinic', name: 'Clinic courtyard',
      point: {x: 2200, y: 1700}, radius: 360,
      enemies: [
        {type: 'soldier', x: 2110, y: 1610},
        {type: 'soldier', x: 2390, y: 1750},
        {type: 'soldier', x: 2130, y: 1800},
        {type: 'soldier', x: 2400, y: 1590},
        {type: 'soldier', x: 2090, y: 1450},
        {type: 'soldier', x: 2250, y: 1790},
      ],
    },
    {
      id: 'school', name: 'Old school square',
      point: {x: 700, y: 450}, radius: 350,
      enemies: [
        {type: 'soldier', x: 830, y: 380},
        {type: 'soldier', x: 540, y: 480},
        {type: 'soldier', x: 650, y: 570},
        {type: 'soldier', x: 850, y: 500},
        {type: 'soldier', x: 700, y: 330},
        {type: 'soldier', x: 450, y: 570},
      ],
    },
  ],
  exit: {
    id: 'harbour', name: 'Harbour approach',
    zone: {x: 2380, y: 620, r: 160}, radius: 360,
    enemies: [
      {type: 'soldier', x: 2300, y: 520},
      {type: 'soldier', x: 2520, y: 730},
      {type: 'soldier', x: 2280, y: 700},
      {type: 'soldier', x: 2470, y: 630},
      {type: 'soldier', x: 2120, y: 640},
      {type: 'soldier', x: 2650, y: 680},
    ],
  },
  // Small encounters occupy the actual connecting streets. They do not all
  // rush the landing zone while a player is still learning the controls.
  ambient: [
    {type: 'zombie', x: 410, y: 1850},
    {type: 'zombie', x: 460, y: 1940},
    {type: 'zombie', x: 1120, y: 1700},
    {type: 'soldier', x: 1450, y: 1630},
    {type: 'zombie', x: 1640, y: 1810},
    {type: 'zombie', x: 1900, y: 1730},
    {type: 'zombie', x: 820, y: 1370},
    {type: 'zombie', x: 1000, y: 1140},
    {type: 'soldier', x: 1100, y: 950},
    {type: 'zombie', x: 850, y: 860},
    {type: 'soldier', x: 1640, y: 1260},
    {type: 'zombie', x: 1840, y: 1080},
    {type: 'zombie', x: 2050, y: 1010},
    {type: 'zombie', x: 1610, y: 740},
  ],
  response: {
    delay: 4, count: 6,
    // Inland entry points provide several safe choices when the squad takes
    // either rescue first. The engine still checks current actor separation.
    points: [
      {x: 420, y: 1050}, {x: 1320, y: 480},
      {x: 1830, y: 2010}, {x: 2600, y: 1190},
      {x: 1800, y: 440}, {x: 470, y: 1550},
      {x: 2550, y: 260}, {x: 2250, y: 250}, {x: 2600, y: 400},
    ],
  },
});

// Rectangles are positioned at the sides of streets, not on their centres.
// Most paired buildings leave 90–140 pixels for a three-person formation.
const HUTS = freezeData([
  // Five checkpoint houses make the opening an encounter, not an empty walk.
  [560, 1480, 120, 88, 'entry'], [770, 1470, 120, 90, 'entry'],
  [980, 1550, 126, 88, 'entry'], [970, 1810, 126, 92, 'entry'],
  [560, 1840, 122, 88, 'entry'],
  // Crossroads village: short direct street, longer western tree-lined lane.
  [1080, 1060, 126, 92, 'village'], [1280, 1010, 126, 90, 'village'],
  [1460, 1060, 128, 90, 'village'], [1100, 1390, 126, 90, 'village'],
  [1300, 1360, 126, 92, 'village'],
  // Clinic courtyard is broad enough for a firefight and regrouping.
  [2000, 1480, 128, 92, 'clinic'], [2240, 1480, 134, 90, 'clinic'],
  [2460, 1510, 120, 88, 'clinic'], [1980, 1860, 130, 90, 'clinic'],
  [2270, 1880, 130, 92, 'clinic'],
  // School district has two open lanes into the central playground.
  [460, 230, 130, 90, 'school'], [670, 210, 138, 92, 'school'],
  [930, 280, 126, 90, 'school'], [470, 630, 128, 90, 'school'],
  [820, 620, 128, 90, 'school'], [1010, 540, 126, 90, 'school'],
  // Warehouses frame the final street without sealing the shoreline escape.
  [2190, 360, 134, 94, 'harbour'], [2450, 400, 132, 92, 'harbour'],
  [2520, 530, 132, 94, 'harbour'], [2170, 810, 130, 94, 'harbour'],
  [2460, 830, 132, 94, 'harbour'],
]);

const TREES = freezeData([
  [110, 1590], [170, 1690], [340, 1710], [335, 2070], [520, 2070],
  [370, 1390], [450, 1450], [515, 1360], [590, 1280], [620, 1390],
  [940, 1400], [1020, 1290], [995, 1200], [730, 1130], [710, 1020],
  [560, 930], [670, 870], [740, 900], [350, 810], [350, 650],
  [330, 365], [1140, 250], [1200, 380], [1220, 660], [1170, 770],
  [1470, 450], [1540, 535], [1610, 470], [1750, 590], [1820, 725],
  [1800, 1380], [1810, 1510], [1970, 1330], [2120, 1280], [2270, 1130],
  [2440, 1040], [2620, 1430], [2550, 1810], [2150, 2050], [2410, 2070],
  [1490, 2020], [1300, 2030], [1090, 2110], [920, 2020],
]);

const ROCKS = freezeData([
  [390, 1620], [700, 1920], [1150, 1550], [1540, 1590],
  [1720, 1860], [1830, 1590], [2100, 1840], [2380, 1805],
  [600, 1160], [950, 930], [1170, 840], [830, 750],
  [540, 390], [910, 380], [1790, 940], [2270, 770],
]);

const BARRELS = freezeData([
  [900, 1540], [940, 1820], [680, 1840], [1235, 1380],
  [1430, 1090], [1950, 1830], [2470, 1470], [2130, 1530],
  [812, 235], [608, 659], [964, 653], [2328, 399],
  [2590, 779], [2310, 823],
]);

const ROADS = freezeData([
  // The open main road is quickest, but affords little protection between
  // the checkpoint, crossroads and harbour defenders.
  {width: 92, points: [[130, 2160], [220, 1950], [470, 1840], [760, 1700],
    [1100, 1700], [1320, 1540], [1480, 1530], [1600, 1320], [1730, 1110],
    [1990, 910], [2180, 730], [2380, 620], [2380, 480],
    [2410, 330], [2550, 200]]},
  // The school lane stays beside groves and house corners. It is narrower
  // than the main street while retaining room for the whole formation.
  {width: 66, points: [[760, 1700], [710, 1610], [710, 1430], [850, 1260],
    [900, 1030], [820, 820], [700, 750], [700, 450]]},
  {width: 76, points: [[1100, 1700], [1480, 1760], [1810, 1750], [2200, 1700]]},
  // A northern cross street connects the two rescue districts indirectly;
  // it gives an alternate approach to the exposed harbour road.
  {width: 64, points: [[700, 450], [890, 460], [1130, 470], [1370, 660],
    [1660, 870], [1990, 910]]},
  {width: 66, points: [[2200, 1700], [2420, 1700], [2420, 1420], [2380, 1280],
    [2380, 1030], [2380, 810], [2380, 620]]},
  // Small open streets make each district read as a settlement.
  {width: 60, points: [[460, 1730], [760, 1700], [930, 1750], [1120, 1760]]},
  {width: 60, points: [[700, 760], [700, 450], [700, 350]]},
  {width: 60, points: [[540, 480], [700, 450], [850, 500]]},
  {width: 68, points: [[2110, 1760], [2200, 1700], [2390, 1750]]},
  {width: 64, points: [[2280, 700], [2380, 620], [2470, 630]]},
]);

const CLEARINGS = freezeData([
  [240, 1950, 240, 200], [760, 1700, 310, 245],
  [1380, 1230, 350, 250], [2200, 1700, 350, 290],
  [700, 450, 335, 270], [2380, 620, 300, 285],
  [2550, 225, 130, 130],
]);

const SCENERY = freezeData([
  {type: 'sign', x: 490, y: 1910, variant: 0},
  {type: 'sign', x: 815, y: 1780, variant: 1},
  {type: 'sign', x: 1120, y: 1785, variant: 2},
  {type: 'canvas', x: 583, y: 1605, variant: 1},
  {type: 'handcart', x: 970, y: 1935, variant: 0},
  {type: 'toolroll', x: 1125, y: 1498, variant: 0},
  {type: 'fieldbag', x: 2040, y: 1598, variant: 1},
  {type: 'basin', x: 2300, y: 1601, variant: 0},
  {type: 'canvas', x: 2435, y: 1905, variant: 2},
  {type: 'handcart', x: 982, y: 694, variant: 2},
  {type: 'fieldbag', x: 553, y: 598, variant: 0},
  {type: 'canvas', x: 988, y: 388, variant: 0},
  {type: 'sign', x: 2250, y: 760, variant: 2},
  {type: 'wire', x: 2502, y: 790, variant: 1},
  {type: 'toolroll', x: 2265, y: 951, variant: 1},
  {type: 'canvas', x: 2519, y: 293, variant: 2},
]);

export function createFirstContactWorld(random = () => 0.5) {
  const obstacles = [];
  const put = (type, x, y, w, h, district) => obstacles.push({
    type, x, y, w, h, district,
    hp: type === 'barrel' ? 24 : type === 'hut' ? 160 : Infinity,
    alive: true,
  });
  HUTS.forEach(([x, y, w, h, district]) => put('hut', x, y, w, h, district));
  TREES.forEach(([x, y]) => put('tree', x, y, 25, 27));
  ROCKS.forEach(([x, y]) => put('rock', x, y, 50, 36));
  BARRELS.forEach(([x, y]) => put('barrel', x, y, 23, 27));
  const decorations = [];
  for (let i = 0; i < 740; i++) {
    decorations.push({
      x: 35 + random() * (FIRST_CONTACT.width - 70),
      y: 35 + random() * (FIRST_CONTACT.height - 70),
      type: i % 23 === 0 ? 'flower' : i % 9 === 0 ? 'dirt' : 'grass',
      variant: Math.floor(random() * 4),
    });
  }
  for (const [x, y] of [[810, 1760], [1500, 1430], [1860, 1010],
    [2235, 1800], [850, 575], [2370, 770]]) {
    decorations.push({x, y, type: 'crater'});
  }
  // Preserve the simulation's ordered coastline: first six points describe
  // the northern shore; index 5→6 is the northeast corner; the remainder east.
  const coastline = [
    [-10, 115], [250, 65], [820, 100], [1460, 65], [2190, 95], [2600, 70],
    [2750, 330], [2700, 670], [2740, 1070], [2700, 1430],
    [2750, 1760], [2730, 2010], [2760, 2210],
  ].map(([x, y]) => ({x, y}));
  return {
    width: FIRST_CONTACT.width, height: FIRST_CONTACT.height,
    spawn: {...FIRST_CONTACT.start},
    obstacles, decorations, coastline,
    roads: ROADS.map(road => ({width: road.width, points: road.points.map(point => [...point])})),
    clearings: CLEARINGS.map(clearing => [...clearing]),
    scenery: SCENERY.map(prop => ({...prop})),
    landmarks: [
      {id: 'entry', type: 'checkpoint', name: 'Village checkpoint', x: 760, y: 1700, r: 150},
      {id: 'clinic', type: 'clinic', name: 'Clinic courtyard', x: 2200, y: 1700, r: 130},
      {id: 'school', type: 'school', name: 'Old school square', x: 700, y: 450, r: 130},
      {id: 'harbour', type: 'harbour', name: 'Harbour approach', x: 2380, y: 620, r: 160},
    ],
  };
}
