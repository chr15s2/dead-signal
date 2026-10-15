/**
 * Authored sabotage and relay missions. The two operations share the island's
 * visual language, but their compounds, streets and defensive positions differ.
 * Definitions are immutable; each game receives fresh destructible geometry.
 * Original content, MIT licensed; see the project LICENSE.
 */
function freezeData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

export const SABOTAGE = freezeData({
  width: 2300, height: 1750,
  start: {x: 220, y: 1510},
  extraction: {x: 280, y: 220, r: 86},
  targets: [
    {
      id: 'warehouse', name: 'Warehouse receiver',
      point: {x: 760, y: 460}, radius: 350,
      enemies: [
        {type: 'soldier', x: 725, y: 370},
        {type: 'soldier', x: 970, y: 425},
        {type: 'soldier', x: 620, y: 550},
        {type: 'soldier', x: 1010, y: 590},
        {type: 'soldier', x: 795, y: 730},
      ],
    },
    {
      id: 'fuel-yard', name: 'Fuel-yard jammer',
      point: {x: 1810, y: 1230}, radius: 360,
      enemies: [
        {type: 'soldier', x: 1680, y: 1120},
        {type: 'soldier', x: 1910, y: 1180},
        {type: 'soldier', x: 1640, y: 1280},
        {type: 'soldier', x: 1950, y: 1360},
        {type: 'soldier', x: 1810, y: 1320},
      ],
    },
  ],
  ambient: [
    {type: 'zombie', x: 410, y: 1430},
    {type: 'zombie', x: 490, y: 1280},
    {type: 'soldier', x: 900, y: 965},
    {type: 'zombie', x: 1130, y: 870},
    {type: 'soldier', x: 1320, y: 925},
    {type: 'zombie', x: 1450, y: 1120},
    {type: 'zombie', x: 1700, y: 1490},
    {type: 'zombie', x: 570, y: 850},
    {type: 'soldier', x: 360, y: 650},
    {type: 'zombie', x: 1280, y: 590},
  ],
});

export const TRANSMISSION = freezeData({
  width: 2200, height: 1800,
  start: {x: 220, y: 1550},
  extraction: {x: 1960, y: 250, r: 86},
  relays: [
    {
      id: 'village', name: 'Village repeater',
      zone: {x: 700, y: 1190, r: 115}, duration: 12, radius: 330,
      enemies: [
        {type: 'soldier', x: 560, y: 1160},
        {type: 'soldier', x: 860, y: 1160},
        {type: 'soldier', x: 760, y: 990},
        {type: 'soldier', x: 890, y: 1320},
        {type: 'soldier', x: 570, y: 1350},
      ],
    },
    {
      id: 'ridge', name: 'Ridge mast',
      zone: {x: 1750, y: 480, r: 115}, duration: 13, radius: 350,
      enemies: [
        {type: 'soldier', x: 1640, y: 470},
        {type: 'soldier', x: 1910, y: 500},
        {type: 'soldier', x: 1700, y: 340},
        {type: 'soldier', x: 1750, y: 670},
        {type: 'soldier', x: 1550, y: 540},
      ],
    },
  ],
  ambient: [
    {type: 'zombie', x: 410, y: 1510},
    {type: 'zombie', x: 590, y: 1420},
    {type: 'zombie', x: 1000, y: 1090},
    {type: 'zombie', x: 1110, y: 930},
    {type: 'soldier', x: 1280, y: 880},
    {type: 'zombie', x: 1470, y: 840},
    {type: 'zombie', x: 1530, y: 750},
    {type: 'zombie', x: 1010, y: 600},
    {type: 'soldier', x: 1240, y: 520},
    {type: 'zombie', x: 1910, y: 820},
  ],
});

const SABOTAGE_LAYOUT = freezeData({
  huts: [
    // Offset warehouse roofs leave a broad cross-shaped firing courtyard.
    [500, 240, 200, 100, 'warehouse'], [820, 240, 190, 100, 'warehouse'],
    [500, 640, 190, 100, 'warehouse'], [860, 640, 190, 100, 'warehouse'],
    [1130, 390, 160, 120, 'warehouse'],
    // A small workers' settlement breaks up the approach and western retreat.
    [400, 1080, 126, 92, 'workers'], [670, 1130, 130, 92, 'workers'],
    [330, 820, 124, 92, 'workers'], [370, 420, 120, 90, 'workers'],
    // The central depot offers a covered alley around the direct road.
    [1030, 1040, 150, 100, 'depot'], [1210, 1040, 150, 100, 'depot'],
    [1300, 650, 154, 104, 'depot'], [1500, 720, 150, 100, 'depot'],
    // Staggered fuel sheds make the second site wider and more exposed.
    [1530, 880, 170, 100, 'fuel-yard'], [1850, 970, 180, 100, 'fuel-yard'],
    [1460, 1400, 180, 100, 'fuel-yard'], [1870, 1410, 180, 100, 'fuel-yard'],
    [2060, 1360, 130, 90, 'fuel-yard'],
  ],
  trees: [
    [110, 1210], [150, 1320], [340, 1600], [480, 1560], [650, 1510],
    [920, 1550], [1110, 1510], [1240, 1440], [1360, 1550], [1750, 1570],
    [2120, 1500], [2190, 1320], [2200, 1010], [2120, 850], [1950, 790],
    [1810, 660], [1720, 430], [1560, 300], [1420, 240], [1250, 200],
    [1090, 190], [440, 120], [190, 360], [150, 560], [180, 730],
    [210, 1020], [590, 970], [750, 890], [820, 1110], [970, 1170],
    [1140, 660], [1130, 1290], [1320, 1290], [1680, 840], [2040, 410],
  ],
  rocks: [
    [460, 1420], [700, 1080], [540, 780], [400, 580],
    [1050, 850], [1210, 950], [1390, 970], [1370, 1170],
    [1710, 1360], [1980, 1300], [1830, 1110], [2150, 1050],
    [1050, 365], [645, 390], [1140, 535], [1760, 720],
  ],
  barrels: [
    [670, 350], [1020, 350], [570, 610], [940, 610],
    [700, 530], [1245, 520], [1010, 1160], [1390, 1060],
    [1685, 1030], [1815, 1070], [1930, 1280], [1850, 1370],
    [2050, 1300], [1560, 1340],
  ],
  roads: [
    {width: 86, points: [[130, 1700], [220, 1510], [420, 1420], [560, 1220],
      [690, 1040], [850, 900], [1050, 810], [1200, 800], [1420, 890],
      [1600, 1130], [1810, 1230], [2100, 1230]]},
    {width: 76, points: [[850, 900], [760, 780], [760, 460], [760, 170]]},
    {width: 70, points: [[760, 460], [1100, 460], [1100, 760], [1200, 800]]},
    // The coastal lane returns west without crossing the warehouse courtyard.
    {width: 62, points: [[420, 1420], [280, 1190], [270, 990], [260, 740],
      [270, 540], [280, 220]]},
    {width: 66, points: [[760, 460], [560, 460], [550, 380], [460, 380], [460, 180],
      [400, 180], [280, 220]]},
    {width: 60, points: [[560, 1220], [850, 1320], [1110, 1220],
      [1410, 1240], [1610, 1230], [1810, 1230]]},
    {width: 62, points: [[1200, 800], [1200, 610], [1450, 530],
      [1690, 610], [1740, 810], [1770, 1030], [1810, 1230]]},
    {width: 60, points: [[1610, 1230], [1720, 1510], [1810, 1510], [1810, 1230]]},
    {width: 58, points: [[1810, 1230], [2010, 1120], [2110, 1100], [2110, 930]]},
  ],
  clearings: [
    [220, 1510, 220, 180], [760, 460, 370, 300], [1210, 900, 370, 270],
    [1810, 1230, 430, 340], [280, 240, 145, 155], [480, 1180, 230, 240],
  ],
  scenery: [
    {type: 'sign', x: 370, y: 1470, variant: 0},
    {type: 'canvas', x: 560, y: 1160, variant: 1},
    {type: 'handcart', x: 835, y: 760, variant: 1},
    {type: 'wire', x: 780, y: 365, variant: 0},
    {type: 'wire', x: 1060, y: 510, variant: 1},
    {type: 'toolroll', x: 610, y: 610, variant: 1},
    {type: 'canvas', x: 995, y: 760, variant: 2},
    {type: 'sign', x: 925, y: 925, variant: 2},
    {type: 'handcart', x: 1190, y: 1160, variant: 2},
    {type: 'canvas', x: 1480, y: 900, variant: 0},
    {type: 'wire', x: 1810, y: 1125, variant: 1},
    {type: 'toolroll', x: 2015, y: 1350, variant: 0},
    {type: 'handcart', x: 1690, y: 1460, variant: 0},
    {type: 'sign', x: 330, y: 350, variant: 2},
  ],
  craters: [[450, 1370], [900, 830], [1170, 970], [1630, 1180], [1930, 1210]],
  coast: [
    [-10, 105], [230, 60], [660, 85], [1120, 55], [1650, 90], [2100, 65],
    [2260, 290], [2230, 540], [2260, 810], [2235, 1090],
    [2270, 1350], [2250, 1570], [2280, 1760],
  ],
  landmarks: [
    {id: 'warehouse', type: 'warehouse', name: 'Warehouse receiver', x: 760, y: 460, r: 150},
    {id: 'depot', type: 'depot', name: 'Freight depot', x: 1210, y: 900, r: 150},
    {id: 'fuel-yard', type: 'fuel-yard', name: 'Fuel-yard jammer', x: 1810, y: 1230, r: 160},
    {id: 'western-beach', type: 'extraction', name: 'Western beach', x: 280, y: 220, r: 86},
  ],
});

const TRANSMISSION_LAYOUT = freezeData({
  huts: [
    // The first signal site is a village square, entered from two open lanes.
    [420, 1040, 130, 90, 'village'], [610, 1010, 138, 92, 'village'],
    [830, 940, 132, 92, 'village'], [480, 1460, 130, 90, 'village'],
    [680, 1400, 138, 92, 'village'], [920, 1360, 128, 90, 'village'],
    // Courtyard houses flank the crossing instead of blocking the route.
    [1050, 1110, 132, 92, 'crossroads'], [1260, 1080, 132, 92, 'crossroads'],
    [1040, 730, 134, 92, 'crossroads'], [1530, 970, 134, 92, 'crossroads'],
    [1100, 400, 134, 92, 'upland'], [1390, 390, 132, 92, 'upland'],
    // Mast outbuildings leave the centre and the northeast escape open.
    [1490, 270, 150, 100, 'ridge'], [1890, 280, 140, 100, 'ridge'],
    [1470, 610, 140, 100, 'ridge'], [1840, 650, 150, 100, 'ridge'],
    [1940, 1040, 130, 90, 'coast'],
  ],
  trees: [
    [100, 1310], [160, 1400], [340, 1640], [560, 1590], [820, 1600],
    [1090, 1530], [1340, 1480], [1540, 1510], [1780, 1460], [2000, 1380],
    [2080, 1190], [2060, 880], [2030, 640], [1480, 1000], [1590, 1110],
    [1760, 1070], [1850, 890], [1360, 920], [1160, 1260], [970, 1210],
    [750, 850], [620, 910], [470, 850], [420, 670], [530, 550],
    [700, 490], [830, 380], [950, 280], [1080, 200], [1270, 170],
    [1450, 160], [1770, 140], [1860, 150], [190, 440], [180, 760],
    [280, 1010], [950, 610], [1180, 650], [1340, 590], [1690, 840],
  ],
  rocks: [
    [390, 1370], [550, 1240], [790, 1230], [850, 1080],
    [970, 930], [1180, 1000], [1440, 880], [1560, 790],
    [1550, 390], [1830, 390], [1620, 560], [1930, 580],
    [1910, 920], [1060, 580], [760, 700], [1270, 360],
  ],
  barrels: [
    [570, 1080], [825, 1040], [840, 1360], [1070, 1230],
    [1170, 830], [1505, 800], [1515, 570], [1630, 340],
    [1890, 400], [1810, 720], [2010, 990],
  ],
  roads: [
    {width: 82, points: [[130, 1750], [220, 1550], [400, 1480], [600, 1330],
      [700, 1190], [900, 1170], [1030, 1000], [1200, 920], [1400, 1000],
      [1600, 900], [1720, 750], [1750, 480], [1790, 200], [1960, 250]]},
    // A western grove is longer but offers cover before the final relay.
    {width: 62, points: [[700, 1190], [790, 1120], [790, 940], [850, 780], [850, 590],
      [1020, 540], [1260, 540], [1420, 560], [1750, 480]]},
    {width: 68, points: [[700, 1190], [520, 1190], [380, 1260], [340, 1450]]},
    {width: 62, points: [[700, 1190], [780, 1320], [900, 1290], [1030, 1000]]},
    {width: 70, points: [[1200, 920], [1240, 830], [1240, 540], [1420, 520]]},
    {width: 62, points: [[1400, 1000], [1600, 1190], [1810, 1190],
      [1870, 1000], [1750, 830], [1750, 480]]},
    {width: 60, points: [[1750, 480], [1970, 460], [2075, 420], [2075, 230], [1960, 250]]},
    {width: 58, points: [[1750, 480], [1650, 740], [1430, 770], [1400, 570]]},
  ],
  clearings: [
    [220, 1550, 210, 190], [700, 1190, 350, 300],
    [1210, 960, 360, 290], [1750, 480, 355, 300],
    [1900, 270, 200, 160], [1060, 540, 270, 175],
  ],
  scenery: [
    {type: 'sign', x: 390, y: 1540, variant: 0},
    {type: 'handcart', x: 590, y: 1450, variant: 2},
    {type: 'canvas', x: 580, y: 1160, variant: 1},
    {type: 'wire', x: 800, y: 1150, variant: 0},
    {type: 'toolroll', x: 845, y: 1230, variant: 0},
    {type: 'basin', x: 930, y: 1300, variant: 0},
    {type: 'sign', x: 940, y: 1010, variant: 1},
    {type: 'handcart', x: 1230, y: 1190, variant: 0},
    {type: 'canvas', x: 1180, y: 860, variant: 2},
    {type: 'sign', x: 1360, y: 680, variant: 2},
    {type: 'wire', x: 1640, y: 420, variant: 1},
    {type: 'toolroll', x: 1810, y: 610, variant: 1},
    {type: 'canvas', x: 1920, y: 420, variant: 0},
    {type: 'handcart', x: 1660, y: 720, variant: 1},
  ],
  craters: [[450, 1450], [850, 1250], [1100, 970], [1490, 870], [1860, 570]],
  coast: [
    [-10, 105], [250, 60], [650, 90], [1070, 60], [1550, 95], [2000, 70],
    [2150, 290], [2115, 540], [2150, 830], [2120, 1100],
    [2160, 1380], [2130, 1620], [2170, 1810],
  ],
  landmarks: [
    {id: 'village', type: 'village', name: 'Village repeater', x: 700, y: 1190, r: 115},
    {id: 'crossroads', type: 'crossroads', name: 'Ridge road', x: 1210, y: 960, r: 150},
    {id: 'ridge', type: 'relay', name: 'Ridge mast', x: 1750, y: 480, r: 115},
    {id: 'coastal-flare', type: 'extraction', name: 'Coastal flare', x: 1960, y: 250, r: 86},
  ],
});

export function createFieldMissionWorld(mission, random = () => 0.5) {
  const sabotage = mission === 1;
  const definition = sabotage ? SABOTAGE : TRANSMISSION;
  const layout = sabotage ? SABOTAGE_LAYOUT : TRANSMISSION_LAYOUT;
  const obstacles = [];
  const put = (type, x, y, w, h, district) => obstacles.push({
    type, x, y, w, h, district,
    hp: type === 'barrel' ? 24 : type === 'hut' ? 160 : Infinity, alive: true,
  });
  layout.huts.forEach(([x, y, w, h, district]) => put('hut', x, y, w, h, district));
  layout.trees.forEach(([x, y]) => put('tree', x, y, 25, 27));
  layout.rocks.forEach(([x, y]) => put('rock', x, y, 50, 36));
  layout.barrels.forEach(([x, y]) => put('barrel', x, y, 23, 27));
  const decorations = [];
  const count = Math.round(definition.width * definition.height / 8000);
  for (let i = 0; i < count; i++) decorations.push({
    x: 30 + random() * (definition.width - 60),
    y: 30 + random() * (definition.height - 60),
    type: i % 23 === 0 ? 'flower' : i % 7 === 0 ? 'dirt' : 'grass',
    variant: Math.floor(random() * 4),
  });
  for (const [x, y] of layout.craters) decorations.push({x, y, type: 'crater'});
  // First six vertices form the northern shoreline, 5→6 the northeast corner,
  // and the remaining vertices the eastern edge, as the collision code expects.
  return {
    width: definition.width, height: definition.height, spawn: {...definition.start},
    obstacles, decorations,
    coastline: layout.coast.map(([x, y]) => ({x, y})),
    roads: layout.roads.map(road => ({width: road.width, points: road.points.map(point => [...point])})),
    clearings: layout.clearings.map(clearing => [...clearing]),
    scenery: layout.scenery.map(prop => ({...prop})),
    landmarks: layout.landmarks.map(landmark => ({...landmark})),
  };
}
