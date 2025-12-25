



import { WeaponType } from './types';

export const GAME_CONSTANTS = {
  // Base Speeds (degrees per tick)
  MAX_SPEED_ZOMBIE: 0.000008, // Slightly increased to make them more dangerous
  MAX_SPEED_SOLDIER: 0.000008,   
  MAX_SPEED_CIVILIAN: 0.000005,  
  
  // Speed Multipliers
  MULT_SPRINT: 1.2, 
  MULT_WANDER: 0.6, 

  // Ranges (degrees)
  INFECTION_RANGE: 0.00022, // Increased range to make infection easier
  VISION_RANGE_ZOMBIE: 0.0030, // Increased vision  
  VISION_RANGE_HUMAN: 0.0030,
  
  // Steering Forces (Weights)
  FORCE_SEPARATION: 3.0, 
  FORCE_SEEK: 1.5,       
  FORCE_FLEE: 4.0,       
  FORCE_WANDER: 0.8,     
  FORCE_COHESION: 0.2,   
  
  // Physics
  SEPARATION_RADIUS: 0.00015, 
  
  // Area of Effect
  AIRSTRIKE_RADIUS: 0.0012,
  SUPPLY_RADIUS: 0.0015,
  
  // Game Logic
  TICK_RATE: 50, // ms
  INITIAL_POPULATION: 120,
  SPAWN_RADIUS: 0.0025,
  INFECTION_DURATION: 5000, // 5 seconds of continuous contact needed
  ROCKET_AMMO_LIMIT: 3,
  SNIPER_COOLDOWN: 5000, // 5 seconds cooldown for snipers
  
  // Economy & Cooldowns
  INITIAL_RESOURCES: 1000,
  PASSIVE_INCOME: 0, // No auto money
  
  COST_SUPPLY: 50,
  COST_SPEC_OPS: 100,
  COST_AIRSTRIKE: 200,
  COST_MEDIC: 50,

  // Cooldowns (ms)
  COOLDOWN_SUPPLY: 30000,    // 30s
  COOLDOWN_SPECOPS: 60000,   // 60s
  COOLDOWN_AIRSTRIKE: 120000,// 120s
  COOLDOWN_MEDIC: 80000,     // 80s

  // Mechanics
  NET_DURATION: 30000, // 30s (in ms, convert to ticks in logic)
  HEAL_DURATION: 5000, // 5s
};

export const WEAPON_STATS = {
  [WeaponType.PISTOL]: {
    range: 0.0005,
    damage: 4,
    color: '#FBBF24', 
    name: 'M1911手枪',
    description: '近距离自卫武器'
  },
  [WeaponType.SHOTGUN]: {
    range: 0.0004,
    damage: 15,
    color: '#F97316', 
    name: '雷明顿霰弹枪',
    description: '近战高伤害面杀伤'
  },
  [WeaponType.SNIPER]: {
    range: 0.0018, // Significantly increased range
    damage: 20, 
    color: '#FFFFFF', 
    name: 'AWM狙击步枪',
    description: '超远距离精准打击'
  },
  [WeaponType.ROCKET]: {
    range: 0.0008,
    damage: 25,
    splashRadius: 0.0004,
    color: '#EF4444', 
    name: 'AT4火箭筒',
    description: '范围无差别杀伤 (限3发)'
  },
  [WeaponType.NET_GUN]: {
    range: 0.0006,
    damage: 0, // No damage
    color: '#2DD4BF', // Teal
    name: '高强度网枪',
    description: '困住僵尸30秒'
  }
};

export const WEAPON_SYMBOLS = {
  [WeaponType.PISTOL]: 'I',
  [WeaponType.SHOTGUN]: '∴',
  [WeaponType.SNIPER]: '⌖',
  [WeaponType.ROCKET]: '●',
  [WeaponType.NET_GUN]: '#'
};

export const DEFAULT_LOCATION = {
  lat: 40.7580,
  lng: -73.9855
};

export const CHINESE_SURNAMES = [
  '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗'
];

export const CHINESE_GIVEN_NAMES_MALE = [
  '伟', '强', '磊', '洋', '勇', '军', '杰', '涛', '明', '刚',
  '平', '辉', '鹏', '华', '飞', '鑫', '波', '斌', '宇', '浩'
];

export const CHINESE_GIVEN_NAMES_FEMALE = [
  '芳', '娜', '敏', '静', '秀', '娟', '英', '华', '慧', '巧',
  '美', '兰', '霞', '玲', '燕', '萍', '雪', '琳', '洁', '梅'
];

export const THOUGHTS = {
  CIVILIAN_CALM: [
    "今天天气真不错", "晚饭吃什么呢？", "最近工作压力好大", "想喝杯奶茶", 
    "刚才那个人好眼熟", "手机快没电了", "想回家睡觉", "这个周末去哪玩？"
  ],
  CIVILIAN_PANIC: [
    "救命啊！", "那是什么鬼东西？！", "别过来！", "我要回家！", 
    "警察在哪里？！", "我的腿在发抖...", "快跑！快跑！", "我不想死..."
  ],
  CIVILIAN_ARMED: [
    "离我远点！", "我会开枪的！", "保护大家！", "跟它们拼了！", 
    "瞄准头！", "为了生存！"
  ],
  ZOMBIE: [
    "饿...", "肉...", "血...", "吃...", "痛...", "吼..."
  ],
  ZOMBIE_TRAPPED: [
    "吼！！！", "放开...", "挣扎...", "动不了..."
  ],
  SOLDIER: [
    "保持队形！", "目标已锁定", "开火！", "清理区域", "确认击毙"
  ],
  MEDIC: [
    "坚持住！", "我能治好你", "正在注射抗病毒血清...", "掩护我！", "不要乱动"
  ],
  FRIENDLY_FIRE: [
    "停火！那是你的友军！", "注意你的射界，笨蛋！", "该死，我被自己人打了！", "各单位注意，发生误伤！", "谁在乱开火？！"
  ],
  SOLDIER_COMPLAINT: [
    "真是个灾难，给这些平民发枪简直是自杀...", "嘿！看着点你的枪管，那是冲我飞过来的！", "指挥部，这些拿枪的平民比僵尸还危险...", 
    "如果你拿不稳，就把枪还给我们专业人士！", "又是一个乱射的，我得离他远点。"
  ],
  ARMED_CIVILIAN: [
    "我也能战斗了！指挥部听到吗？", "发现一个活死人，正在瞄准！", "为了我的家人，我不会退缩！", 
    "这玩意后坐力真大，但我能行！", "有谁在频道里吗？我这边发现僵尸了！"
  ],
  CORPSE: [
    "...", "（已死亡）", "...", "..."
  ]
};