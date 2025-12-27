
export interface Building {
  id: string;
  geometry: Coordinates[];
  tags: Record<string, string>;
  name: string;
  type: string;
  analysis?: {
    survivalGuide: string;
    tacticalReport: string;
    timestamp: number;
    nearbyStats: {
      zombies: number;
      soldiers: number;
      civilians: number;
    };
    cooldownEnd?: number;
    isAnalyzing?: boolean;
    scavengeCooldownEnd?: number;
    scavengeCount?: number;
  };
}

export enum BGMState {
  NONE = 'NONE',
  SAFE = 'SAFE',
  DANGER = 'DANGER',
  COMBAT = 'COMBAT'
}

export enum EntityType {
  CIVILIAN = 'CIVILIAN',
  ZOMBIE = 'ZOMBIE',
  SOLDIER = 'SOLDIER'
}

export enum CivilianType {
  MAN = 'MAN',
  WOMAN = 'WOMAN',
  CHILD = 'CHILD',
  ELDERLY = 'ELDERLY'
}

export enum ToolType {
  NONE = 'NONE',
  SUPPLY_DROP = 'SUPPLY_DROP', // Arms civilians
  SPEC_OPS = 'SPEC_OPS',       // Spawns soldiers
  AIRSTRIKE = 'AIRSTRIKE',     // Kills zombies in area
  MEDIC_TEAM = 'MEDIC_TEAM',    // Spawns medics to cure trapped zombies
  TACTICAL_ANALYSIS = 'TACTICAL_ANALYSIS' // AI tactical analysis for buildings
}

export enum WeaponType {
  PISTOL = 'PISTOL',
  SNIPER = 'SNIPER',
  SHOTGUN = 'SHOTGUN',
  ROCKET = 'ROCKET',
  NET_GUN = 'NET_GUN'          // Traps zombies
}

export enum SoundType {
  BGM_START = 'BGM_START',
  UI_CLICK = 'UI_CLICK',
  UI_SELECT = 'UI_SELECT',
  UI_ERROR = 'UI_ERROR',
  WEAPON_PISTOL = 'WEAPON_PISTOL',
  WEAPON_SHOTGUN = 'WEAPON_SHOTGUN',
  WEAPON_SNIPER = 'WEAPON_SNIPER',
  WEAPON_ROCKET = 'WEAPON_ROCKET',
  WEAPON_NET = 'WEAPON_NET',
  HEAL_START = 'HEAL_START',
  HEAL_COMPLETE = 'HEAL_COMPLETE',
  DEPLOY_ACTION = 'DEPLOY_ACTION',
  // Civilian Sounds
  CIV_FEAR = 'CIV_FEAR',
  CIV_SCREAM = 'CIV_SCREAM',
  CIV_SHOUT = 'CIV_SHOUT',
  CIV_URGE = 'CIV_URGE',
  CIV_CLAP = 'CIV_CLAP',
  CIV_CRY = 'CIV_CRY',
  // Zombie Sounds
  ZOM_ROAR = 'ZOM_ROAR',
  ZOM_BITE = 'ZOM_BITE',
  ZOM_FIGHT = 'ZOM_FIGHT',
  AIRSTRIKE_TICK = 'AIRSTRIKE_TICK'
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Vector {
  x: number; // Represents lat delta
  y: number; // Represents lng delta
}

export interface GameEntity {
  id: string;
  type: EntityType;
  subType?: CivilianType; // Only for civilians
  
  // Bio Data
  name: string;
  age: number;
  gender: string; // Display string (男/女)
  thought: string; // Inner monologue
  
  position: Coordinates;
  velocity: Vector; // Current movement vector
  wanderAngle: number; // For smooth wandering
  
  // Status
  isInfected: boolean;
  infectionRiskTimer: number; // Time spent in continuous contact with zombie
  isArmed: boolean; 
  isDead: boolean;
  isTrapped: boolean; // Net gun effect
  trappedTimer: number; // How long until net breaks
  
  // Combat / Role
  weaponType?: WeaponType; 
  ammo?: number; // For limited ammo weapons like Rocket
  lastFiredTime?: number; // Cooldown tracking
  health: number;
  
  // Medic Logic
  isMedic: boolean; // Is this entity a medic?
  healingTargetId?: string; // ID of the zombie being cured
  healingTimer: number; // Progress of curing
  
  homeLocationName?: string; // For richer dialogues
  currentLocationName?: string; // For real-time location awareness
  locationMetadata?: any; // Detailed LocationInfo from mapDataService
  
  // Mood / Bubbling
  moodIcon?: string;    // Current active emoji
  moodTimer?: number;   // Duration left for the bubble (ms)
  wasInsideBuilding?: boolean; // For boundary transition detection
}

export interface WeaponItem {
  id: string;
  type: WeaponType;
  position: Coordinates;
  timestamp: number;
}

export interface StrikeZone {
  id: string;
  position: Coordinates;
  radius: number;
  startTime: number;
  duration: number; // typically 5000ms
}

export interface Crater {
  id: string;
  position: Coordinates;
  radius: number;
  timestamp: number;
}

export interface GameState {
  isPlaying: boolean;
  isPaused: boolean;
  healthyCount: number;
  infectedCount: number;
  soldierCount: number;
  gameResult: 'VICTORY' | 'DEFEAT' | null;
  resources: number; 
  selectedEntity: GameEntity | null; 
  selectedBuilding: Building | null; 
  
  // Cooldowns (Timestamp when available)
  cooldowns: {
    [key in ToolType]?: number;
  };
  
  droppedWeapons: WeaponItem[];
}

export interface RadioMessage {
  id: string;
  sender: string;
  senderId?: string;
  text: string;
  timestamp: number;
}

// Visual effect for a shot or explosion
export interface VisualEffect {
  id: string;
  type: 'SHOT' | 'EXPLOSION' | 'NET' | 'HEAL';
  p1: Coordinates;
  p2?: Coordinates; // Target position for shots
  color: string;
  radius?: number; // For explosions
  timestamp: number;
}