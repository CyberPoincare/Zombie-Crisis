
import React, { useEffect, useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, Circle, Polygon, Pane } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, EntityType, CivilianType, GameEntity, GameState, RadioMessage, ToolType, Vector, WeaponType, VisualEffect, SoundType, Building, BGMState, WeaponItem, StrikeZone, Crater, BuildingType } from '../types';
import { GAME_CONSTANTS, DEFAULT_LOCATION, WEAPON_STATS, WEAPON_SYMBOLS, MOOD_ICONS } from '../constants';
import { NAMES_DATA } from '../namesData';
import { generateRadioChatter, generateTacticalAnalysis } from '../services/geminiService';
import { audioService } from '../services/audioService';
import { mapDataService } from '../services/mapDataService';

// --- Vector Math Helpers ---
const getVecDistance = (p1: Coordinates, p2: Coordinates) => {
  return Math.sqrt(Math.pow(p1.lat - p2.lat, 2) + Math.pow(p1.lng - p2.lng, 2));
};

const normalize = (v: Vector): Vector => {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
};

const addVec = (v1: Vector, v2: Vector): Vector => ({ x: v1.x + v2.x, y: v1.y + v2.y });
const subVec = (v1: Vector, v2: Vector): Vector => ({ x: v1.x - v2.x, y: v1.y - v2.y });
const multVec = (v: Vector, s: number): Vector => ({ x: v.x * s, y: v.y * s });
const limitVec = (v: Vector, max: number): Vector => {
  const magSq = v.x * v.x + v.y * v.y;
  if (magSq > max * max) {
    const n = normalize(v);
    return multVec(n, max);
  }
  return v;
};

// --- Geometry Helpers ---
const isPointInPolygon = (point: Coordinates, polygon: Coordinates[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > point.lng) !== (yj > point.lng))
        && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// --- Perception Helpers ---
const getAngleDifference = (a1: number, a2: number) => {
  let diff = Math.abs(a1 - a2) % (Math.PI * 2);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff;
};

const canSee = (observer: GameEntity, target: GameEntity, buildings: Building[]) => {
  if (target.isDead) return false;
  
  const d = getVecDistance(observer.position, target.position);
  const range = GAME_CONSTANTS.VISION_RANGE_OUTDOOR;
  if (d > range) return false;

  // Vision Angle Check
  const observerAngle = observer.wanderAngle; // WanderAngle is used as facing direction
  const targetAngle = Math.atan2(target.position.lng - observer.position.lng, target.position.lat - observer.position.lat);
  const angleDiff = getAngleDifference(observerAngle, targetAngle);
  const fov = (observer.type === EntityType.SOLDIER ? GAME_CONSTANTS.VISION_ANGLE_HUMAN : GAME_CONSTANTS.VISION_ANGLE_HUMAN) * (Math.PI / 180);
  if (angleDiff > fov / 2) return false;

  // Building Obstruction
  const obsInside = buildings.find(b => isPointInPolygon(observer.position, b.geometry));
  const targetInside = buildings.find(b => isPointInPolygon(target.position, b.geometry));

  if (obsInside !== targetInside) return false; // One inside, one outside OR different buildings
  
  return true;
};

const canHear = (observer: GameEntity, entities: GameEntity[]) => {
  const range = GAME_CONSTANTS.HEARING_RANGE;
  const nearbyZombies = entities.filter(e => 
    e.type === EntityType.ZOMBIE && 
    !e.isDead && 
    getVecDistance(observer.position, e.position) < range
  ).length;
  
  return nearbyZombies >= GAME_CONSTANTS.HEARING_THRESHOLD_ZOMBIES;
};

const canSmell = (observer: GameEntity, target: GameEntity) => {
  if (target.isDead) return false;
  const d = getVecDistance(observer.position, target.position);
  return d < GAME_CONSTANTS.SMELL_RANGE_ZOMBIE;
};

const getNearestBuilding = (pos: Coordinates, buildings: Building[]) => {
  let nearest: Building | null = null;
  let minDist = 999;
  buildings.forEach(b => {
      // Use the first point as a proxy for building center
      const d = getVecDistance(pos, b.geometry[0]);
      if (d < minDist) { minDist = d; nearest = b; }
  });
  return nearest;
};

// --- Helpers ---
const getRandomName = (isMale: boolean) => {
  const lang = (i18n.language || 'zh').split('-')[0] as keyof typeof NAMES_DATA;
  const data = NAMES_DATA[lang] || NAMES_DATA.en;
  
  const surname = data.surnames[Math.floor(Math.random() * data.surnames.length)];
  const givenNames = isMale ? data.male : data.female;
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
  
  if (lang === 'zh' || lang === 'ja' || lang === 'ko') {
    return surname + givenName;
  }
  return givenName + ' ' + surname;
};

const getRandomWeapon = (): WeaponType => {
  const rand = Math.random();
  // Adjusted probabilities:
  // Pistol: 30%
  // Shotgun: 25%
  // Sniper: 15%
  // Rocket: 10%
  // Net Gun: 20% (Increased)
  if (rand < 0.30) return WeaponType.PISTOL;
  if (rand < 0.55) return WeaponType.SHOTGUN;
  if (rand < 0.70) return WeaponType.SNIPER;
  if (rand < 0.80) return WeaponType.ROCKET;
  return WeaponType.NET_GUN; 
};

const getRandomThought = (entity: GameEntity, neighbors: GameEntity[], nearbyZombies: number, buildings: Building[]) => {
  if (entity.isDead) return i18n.t('thoughts.CORPSE', { returnObjects: true })[0];
  if (entity.isTrapped) {
    const list = i18n.t('thoughts.ZOMBIE_TRAPPED', { returnObjects: true }) as string[];
    return list[Math.floor(Math.random() * list.length)];
  }
  if (entity.isMedic) {
    const list = i18n.t('thoughts.MEDIC', { returnObjects: true }) as string[];
    return list[Math.floor(Math.random() * list.length)];
  }

  let poolName: string = '';
  
  if (entity.type === EntityType.ZOMBIE) {
    poolName = 'ZOMBIE';
  } else if (entity.type === EntityType.SOLDIER) {
    const nearbyArmedCiv = neighbors.find(n => n.type === EntityType.CIVILIAN && n.isArmed && getVecDistance(entity.position, n.position) < 0.001);
    
    const meta = entity.locationMetadata;
    if (meta && Math.random() < 0.3) {
      const road = meta.road || i18n.t('road_placeholder');
      const feat = meta.feature;
      const loc = entity.currentLocationName;
      
      const list = (feat && Math.random() < 0.5) 
        ? i18n.t('thoughts.dynamic.soldier_feat', { returnObjects: true, feat }) as string[]
        : (Math.random() < 0.5 
          ? i18n.t('thoughts.dynamic.soldier_road', { returnObjects: true, road }) as string[]
          : i18n.t('thoughts.dynamic.soldier_loc', { returnObjects: true, loc }) as string[]);
      
      return list[Math.floor(Math.random() * list.length)];
    }

    poolName = (nearbyArmedCiv && Math.random() < 0.3) ? 'SOLDIER_COMPLAINT' : 'SOLDIER';
  } else {
      // Civilian
      const meta = entity.locationMetadata;
      if (meta && Math.random() < 0.45) {
        const road = meta.road || i18n.t('road_placeholder');
        const feat = meta.feature;
        const sub = meta.suburb;
        const loc = entity.currentLocationName;

        const list = (feat && Math.random() < 0.3)
          ? i18n.t('thoughts.dynamic.civilian_feat', { returnObjects: true, feat }) as string[]
          : (sub && Math.random() < 0.3)
            ? i18n.t('thoughts.dynamic.civilian_sub', { returnObjects: true, sub }) as string[]
            : i18n.t('thoughts.dynamic.civilian_road', { returnObjects: true, loc, road }) as string[];
            
        return list[Math.floor(Math.random() * list.length)];
      }

      if (entity.homeLocationName && Math.random() < 0.15) {
        const home = entity.homeLocationName;
        const list = i18n.t('thoughts.dynamic.civilian_home', { returnObjects: true, home }) as string[];
        return list[Math.floor(Math.random() * list.length)];
      }

      // Proximity checks for reactive thoughts
      const SEARCH_DIST = 0.002;
      const zombiesVeryClose = neighbors.filter(n => n.type === EntityType.ZOMBIE && getVecDistance(entity.position, n.position) < 0.001);
      const nearbySoldiers = neighbors.filter(n => n.type === EntityType.SOLDIER && getVecDistance(entity.position, n.position) < SEARCH_DIST);
      const nearbyMedics = neighbors.filter(n => n.isMedic && getVecDistance(entity.position, n.position) < SEARCH_DIST);

      if (zombiesVeryClose.length > 0 && Math.random() < 0.6) {
          poolName = 'CIVILIAN_SEE_ZOMBIE_CLOSE';
      } else if (nearbyMedics.length > 0 && Math.random() < 0.4) {
          poolName = 'CIVILIAN_SEE_MEDIC';
      } else if (nearbySoldiers.length > 0 && Math.random() < 0.4) {
          poolName = 'CIVILIAN_SEE_SOLDIER';
      } else if (entity.panicTimer && entity.panicTimer > 0) {
          poolName = 'CIVILIAN_PANIC';
          if (nearbyZombies === 0 && Math.random() < 0.5) poolName = 'CIVILIAN_HIDING';
      } else {
          const isInside = buildings.some(b => isPointInPolygon(entity.position, b.geometry));
          const thoughtRoll = Math.random();
          if (thoughtRoll < 0.2) {
              poolName = 'CIVILIAN_MEMORIES';
          } else if (thoughtRoll < 0.4) {
              poolName = 'CIVILIAN_SURVIVAL';
          } else if (entity.isArmed) {
              poolName = Math.random() < 0.5 ? 'ARMED_CIVILIAN' : 'CIVILIAN_ARMED';
          } else if (isInside && Math.random() < 0.4) {
              poolName = 'CIVILIAN_INDOOR';
          } else {
              poolName = 'CIVILIAN_CALM';
          }
      }
  }

  const list = i18n.t(`thoughts.${poolName}`, { returnObjects: true }) as string[];
  return list[Math.floor(Math.random() * list.length)];
};

const getRandomMood = (entity: GameEntity, nearbyZombiesCount: number) => {
    if (entity.isDead) return undefined;
    if (entity.isTrapped) return MOOD_ICONS.ZOMBIE_TRAPPED[Math.floor(Math.random() * MOOD_ICONS.ZOMBIE_TRAPPED.length)];
    if (entity.isMedic) return MOOD_ICONS.MEDIC[Math.floor(Math.random() * MOOD_ICONS.MEDIC.length)];
    
    if (entity.type === EntityType.ZOMBIE) {
        return MOOD_ICONS.ZOMBIE[Math.floor(Math.random() * MOOD_ICONS.ZOMBIE.length)];
    } else if (entity.type === EntityType.SOLDIER) {
        return MOOD_ICONS.SOLDIER[Math.floor(Math.random() * MOOD_ICONS.SOLDIER.length)];
    } else {
        // Civilian
        if (entity.isArmed) return MOOD_ICONS.CIVILIAN_ARMED[Math.floor(Math.random() * MOOD_ICONS.CIVILIAN_ARMED.length)];
        if (nearbyZombiesCount > 0) return MOOD_ICONS.CIVILIAN_PANIC[Math.floor(Math.random() * MOOD_ICONS.CIVILIAN_PANIC.length)];
        return MOOD_ICONS.CIVILIAN_CALM[Math.floor(Math.random() * MOOD_ICONS.CIVILIAN_CALM.length)];
    }
};

const createEntityIcon = (entity: GameEntity, isSelected: boolean) => {
  // Corpse Styling
  if (entity.isDead) {
      const size = isSelected ? 'w-4 h-4' : 'w-3 h-3';
      const ringClass = isSelected ? 'ring-2 ring-white' : '';
      return L.divIcon({
          className: 'bg-transparent',
          html: `<div class="bg-gray-700 ${size} rounded-sm rotate-45 opacity-60 ${ringClass} transition-all"></div>`,
          iconSize: isSelected ? [16, 16] : [12, 12],
          iconAnchor: [6, 6],
      });
  }

  let colorClass = 'bg-blue-500'; 
  let shapeClass = '';
  let size = isSelected ? 'w-5 h-5' : 'w-3 h-3';
  let effectClass = '';
  let ringClass = isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : '';
  let innerContent = '';

  if (entity.type === EntityType.ZOMBIE) {
    colorClass = 'bg-red-600';
    effectClass = 'shadow-[0_0_8px_rgba(220,38,38,0.8)]';
    if (entity.isTrapped) {
        innerContent = '<div class="absolute inset-0 border border-cyan-400 bg-cyan-400/30 animate-pulse"></div>';
        ringClass = 'ring-1 ring-cyan-400';
    }
  } else if (entity.isMedic) {
    colorClass = 'bg-white border border-red-500';
    effectClass = 'shadow-[0_0_5px_rgba(239,68,68,0.8)]';
    innerContent = '<div class="text-[8px] text-red-600 flex items-center justify-center font-bold leading-none h-full">+</div>';
  } else if (entity.type === EntityType.SOLDIER) {
    colorClass = 'bg-blue-500 border border-white';
    effectClass = 'shadow-[0_0_5px_rgba(59,130,246,0.8)]';
    if (entity.weaponType) {
        const symbol = WEAPON_SYMBOLS[entity.weaponType];
        innerContent = `<div class="text-[8px] text-white flex items-center justify-center font-bold leading-none h-full scale-125 drop-shadow-md">${symbol}</div>`;
    }
  } else if (entity.isArmed) {
    colorClass = 'bg-yellow-400';
    if (entity.weaponType) {
       const symbol = WEAPON_SYMBOLS[entity.weaponType];
       innerContent = `<div class="text-[8px] text-black flex items-center justify-center font-bold leading-none h-full scale-125">${symbol}</div>`;
    }
  }

  // Shapes based on type/demographic
  if (entity.isMedic) {
    shapeClass = 'rounded-full'; 
  } else if (entity.type === EntityType.CIVILIAN) {
    switch (entity.subType) {
      case CivilianType.MAN: shapeClass = 'rounded-sm'; break; 
      case CivilianType.WOMAN: shapeClass = 'rounded-full'; break; 
      case CivilianType.CHILD: shapeClass = 'rounded-full scale-75'; break; 
      case CivilianType.ELDERLY: shapeClass = 'rotate-45 rounded-sm'; break; 
    }
  } else {
    shapeClass = 'rounded-full'; 
  }

  // Infection Risk Visual (Purple Pulse)
  if (!entity.isInfected && entity.infectionRiskTimer > 0) {
     ringClass += ' ring-2 ring-purple-500 animate-pulse';
  }

  // Mood Bubble Rendering
  let moodBubble = '';
  if (entity.moodIcon && entity.moodTimer && entity.moodTimer > 0) {
      moodBubble = `
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 flex flex-col items-center animate-bounce-subtle z-50">
            <div class="bg-white rounded-full p-1 shadow-lg border border-slate-200 flex items-center justify-center w-6 h-6 text-sm">
                ${entity.moodIcon}
            </div>
            <div class="w-1.5 h-1.5 bg-white border-r border-b border-slate-200 transform rotate-45 -mt-1 shadow-sm"></div>
        </div>
      `;
  }

  return L.divIcon({
    className: 'bg-transparent',
    html: `
        <div class="relative">
            ${moodBubble}
            <div class="${colorClass} ${shapeClass} ${size} ${effectClass} ${ringClass} transition-all duration-300 relative overflow-hidden">${innerContent}</div>
        </div>
    `,
    iconSize: isSelected ? [20, 20] : [12, 12],
    iconAnchor: isSelected ? [10, 10] : [6, 6],
  });
};

const EntityMarker = React.memo(({ entity, lat, lng, isSelected, onSelect }: { 
    entity: GameEntity, 
    lat: number, 
    lng: number, 
    isSelected: boolean, 
    onSelect: (id: string) => void,
    // Added these optional props to the type to ensure React.memo detects state changes, 
    // even though we don't use them directly in the component body (they are used by the memo comparison)
    isDead?: boolean,
    isTrapped?: boolean,
    isInfected?: boolean
  }) => {
  
  const eventHandlers = useMemo(() => ({
    click: (ev: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(ev);
      onSelect(entity.id);
      audioService.playSound(SoundType.UI_SELECT);
    }
  }), [entity.id, onSelect]);

  const icon = useMemo(() => 
    createEntityIcon(entity, isSelected), 
    [entity.type, entity.subType, entity.isArmed, entity.isInfected, entity.isDead, entity.isTrapped, entity.isMedic, entity.weaponType, entity.infectionRiskTimer, entity.moodIcon, entity.moodTimer, isSelected]
  );

  return (
    <>
      <style>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translate(-50%, 0); }
          50% { transform: translate(-50%, -4px); }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }
      `}</style>
      <Marker 
        position={[lat, lng]} 
        icon={icon}
        eventHandlers={eventHandlers}
        zIndexOffset={entity.isDead ? -100 : 0} 
      />
    </>
  );
});

const WeaponMarker = React.memo(({ weapon }: { weapon: WeaponItem }) => {
  const icon = useMemo(() => {
    const symbol = WEAPON_SYMBOLS[weapon.type];
    const color = WEAPON_STATS[weapon.type].color;
    return L.divIcon({
      className: 'bg-transparent',
      html: `
        <div class="flex items-center justify-center w-6 h-6 bg-slate-800/90 border border-yellow-500/50 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.3)] animate-pulse">
          <span style="color: ${color}" class="text-[10px] font-bold">${symbol}</span>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }, [weapon.type]);

  return <Marker position={[weapon.position.lat, weapon.position.lng]} icon={icon} interactive={false} />;
});

export interface GameMapRef {
  analyzeBuilding: (id: string) => void;
  scavengeBuilding: (id: string) => void;
}

interface GameMapProps {
  selectedTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  isPaused: boolean;
  onUpdateState: (state: GameState) => void;
  onAddLog: (msg: RadioMessage) => void;
  initialState: GameState;
  selectedEntityId: string | null;
  onEntitySelect: (id: string | null) => void;
  selectedBuildingId: string | null;
  onBuildingSelect: (id: string | null) => void;
  followingEntityId: string | null;
  onCancelFollow: () => void;
  initialCenter?: Coordinates;
}

const MapEvents: React.FC<{ 
  onMapClick: (latlng: L.LatLng) => void, 
  onDrag: () => void, 
  onMoveEnd: (center: Coordinates) => void,
  onMouseMove?: (latlng: L.LatLng) => void
}> = ({ onMapClick, onDrag, onMoveEnd, onMouseMove }) => {
  useMapEvents({
    click(e) { onMapClick(e.latlng); },
    dragstart() { onDrag(); },
    movestart(e) { 
        if (e.hard) return; // ignore programatic
        const originalEvent = (e as any).originalEvent;
        if (originalEvent) onDrag(); // only if user triggered
    },
    moveend(e) {
      const center = e.target.getCenter();
      onMoveEnd({ lat: center.lat, lng: center.lng });
    },
    mousemove(e) {
      onMouseMove?.(e.latlng);
    }
  });
  return null;
};

const LocateController: React.FC<{ followingEntityId: string | null, entities: GameEntity[], onCancelFollow: () => void }> = ({ followingEntityId, entities, onCancelFollow }) => {
  const map = useMapEvents({});
  const lastTargetId = useRef<string | null>(null);

  useEffect(() => {
    if (!followingEntityId) {
        lastTargetId.current = null;
        return;
    }

    const entity = entities.find(e => e.id === followingEntityId);
    if (!entity || entity.isDead) {
        onCancelFollow();
        return;
    }

    if (lastTargetId.current !== followingEntityId) {
        // Initial transition
        map.flyTo([entity.position.lat, entity.position.lng], map.getZoom(), {
          animate: true,
          duration: 1.0
        });
        lastTargetId.current = followingEntityId;
    } else {
        // Sticky follow - frame-sync to fix misalignment
        // Using setView with animate: false inside an effect synced with entities
        map.setView([entity.position.lat, entity.position.lng], map.getZoom(), {
            animate: false
        });
    }
  }, [followingEntityId, entities, map]);

  return null;
};

const GameMap = forwardRef<GameMapRef, GameMapProps>((props, ref) => {
  const { selectedTool, onSelectTool, isPaused, onUpdateState, onAddLog, initialState, selectedEntityId, onEntitySelect, selectedBuildingId, onBuildingSelect, followingEntityId, onCancelFollow, initialCenter } = props;
  const [centerPos, setCenterPos] = useState<Coordinates>(DEFAULT_LOCATION);
  const [entities, setEntities] = useState<GameEntity[]>([]);
  const [effects, setEffects] = useState<VisualEffect[]>([]); 
  const [droppedWeapons, setDroppedWeapons] = useState<WeaponItem[]>([]);
  const [mousePos, setMousePos] = useState<Coordinates | null>(null);
  const [strikeZones, setStrikeZones] = useState<StrikeZone[]>([]);
  const [craters, setCraters] = useState<Crater[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [outbreakPoint, setOutbreakPoint] = useState<Coordinates | null>(null);
  const populationInitializedRef = useRef(false);
  
  
  const entitiesRef = useRef<GameEntity[]>([]);
  const droppedWeaponsRef = useRef<WeaponItem[]>([]);
  const strikeZonesRef = useRef<StrikeZone[]>([]);
  const cratersRef = useRef<Crater[]>([]);
  const stateRef = useRef<GameState>({ ...initialState, droppedWeapons: [], infectionDetected: false });
  const pausedRef = useRef(isPaused);
  const selectedIdRef = useRef(selectedEntityId);
  const selectedBuildingIdRef = useRef(selectedBuildingId);
  const discoveryRef = useRef(false);
  const victoryAnnouncedRef = useRef(false);
  const lowHealthAnnouncedRef = useRef(false);
  const logCounterRef = useRef(0);
  const tickRef = useRef(0);
  const lastCombatTickRef = useRef<number>(0);
  const buildingsRef = useRef<Building[]>([]);
  const getUniqueId = () => `${Date.now()}-${logCounterRef.current++}`;

  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { selectedIdRef.current = selectedEntityId; }, [selectedEntityId]);
  useEffect(() => { selectedBuildingIdRef.current = selectedBuildingId; }, [selectedBuildingId]);

  const lastLogsRef = useRef<Record<string, { text: string, time: number }>>({});

  const addLog = useCallback((data: Omit<RadioMessage, 'id' | 'timestamp'>) => {
    const now = Date.now();
    const senderKey = data.senderId || data.sender;
    const last = lastLogsRef.current[senderKey];
    
    // Throttling: Same sender, same message, within 2 seconds
    if (last && last.text === data.text && now - last.time < 2000) {
        return; 
    }
    
    lastLogsRef.current[senderKey] = { text: data.text, time: now };
    logCounterRef.current++;
    onAddLog({
        ...data,
        id: `${now}-${logCounterRef.current}`,
        timestamp: now
    });
  }, [onAddLog]);

  const getAnalysisForBuilding = (b: Building) => {
    const pos = b.geometry[0]; // Use first point as reference
    const radius = 0.003; // Radius for tactical analysis
    
    const nearbyEntities = entitiesRef.current.filter(e => !e.isDead && getVecDistance(e.position, pos) < radius);
    const zombies = nearbyEntities.filter(e => e.type === EntityType.ZOMBIE).length;
    const soldiers = nearbyEntities.filter(e => e.type === EntityType.SOLDIER).length;
    const civilians = nearbyEntities.filter(e => e.type === EntityType.CIVILIAN).length;

    // Survival Guide (Building & Surroundings)
    let guide = "";
    switch (b.type) {
         case BuildingType.RESIDENTIAL:
           guide = i18n.t('building_analysis.residential_desc');
           break;
         case BuildingType.COMMERCIAL:
           guide = i18n.t('building_analysis.commercial_desc');
           break;
         case BuildingType.INDUSTRIAL:
           guide = i18n.t('building_analysis.industrial_desc');
           break;
         case BuildingType.PUBLIC:
           guide = i18n.t('building_analysis.public_desc');
           break;
         case BuildingType.GENERAL:
           guide = i18n.t('building_analysis.general_desc');
           break;
       }

    // Tactical Analysis (Current real-time data)
    let tactical = "";
    if (zombies > 10) {
        tactical = i18n.t('building_analysis.warning_high_infection', { zombies });
    } else if (zombies > 0) {
        tactical = i18n.t('building_analysis.tactical_zombies_present', { zombies });
    } else {
        tactical = i18n.t('building_analysis.tactical_safe');
    }

    if (soldiers > 0) {
        tactical += ` ${i18n.t('building_analysis.tactical_soldiers', { soldiers })}`;
    }
    if (civilians > 0) {
        tactical += ` ${i18n.t('building_analysis.tactical_civilians', { civilians })}`;
    }

    return {
        survivalGuide: guide,
        tacticalReport: tactical,
        timestamp: Date.now(),
        nearbyStats: { zombies, soldiers, civilians }
    };
  };

  useImperativeHandle(ref, () => ({
    analyzeBuilding: async (id: string) => {
        const b = buildingsRef.current.find(b => b.id === id);
        if (!b) return;

        // Set scanning state
        if (!b.analysis) {
            b.analysis = {
                survivalGuide: '',
                tacticalReport: '',
                timestamp: Date.now(),
                nearbyStats: { zombies: 0, soldiers: 0, civilians: 0 },
                isAnalyzing: true
            };
        } else {
            b.analysis.isAnalyzing = true;
        }
        
        // Sync to show scanning state in UI
        setBuildingsSyncTrigger(prev => prev + 1);
        onUpdateState({...stateRef.current});

        // Show initial intent in log
        addLog({
             sender: i18n.t('headquarters'),
             text: i18n.t('ai_messages.scanning_start', { name: b.name })
        });

        const pos = b.geometry[0];
        
        try {
            // Get geographic context
            const [locationInfo, nearbyFeatures] = await Promise.all([
                mapDataService.getLocationInfo(pos).catch(e => {
                    console.error("Location info fetch failed:", e);
                    return null;
                }),
                mapDataService.getNearbyFeatures(pos).catch(e => {
                    console.error("Nearby features fetch failed:", e);
                    return [];
                })
            ]);

            if (!locationInfo && nearbyFeatures.length === 0) {
                addLog({
                     sender: i18n.t('headquarters'),
                     text: i18n.t('ai_messages.scanning_fail_meta', { name: b.name })
                });
            }

            // Get tactical stats
            const radius = 0.003;
            const nearbyEntities = entitiesRef.current.filter(e => !e.isDead && getVecDistance(e.position, pos) < radius);
            const stats = {
                zombies: nearbyEntities.filter(e => e.type === EntityType.ZOMBIE).length,
                soldiers: nearbyEntities.filter(e => e.type === EntityType.SOLDIER).length,
                civilians: nearbyEntities.filter(e => e.type === EntityType.CIVILIAN).length
            };

            // Call AI
            const analysisResult = await generateTacticalAnalysis(b, nearbyFeatures, locationInfo, stats);

            // Update building
            b.analysis = {
                ...analysisResult,
                timestamp: Date.now(),
                nearbyStats: stats,
                cooldownEnd: Date.now() + GAME_CONSTANTS.COOLDOWN_TACTICAL_ANALYSIS,
                isAnalyzing: false
            };

            // Log completion
            if (analysisResult.survivalGuide === i18n.t('ai_scan_fail_guide')) {
                addLog({
                     sender: i18n.t('headquarters'),
                     text: i18n.t('ai_messages.scanning_error', { name: b.name })
                });
            } else {
                addLog({
                     sender: i18n.t('tactical_ai'),
                     text: i18n.t('ai_messages.scanning_complete', { name: b.name })
                });
            }
            
            // Sync triggers
            setBuildingsSyncTrigger(prev => prev + 1);
            onUpdateState({...stateRef.current});
        } catch (error) {
            console.error("Tactical Analysis Error:", error);
            if (b.analysis) b.analysis.isAnalyzing = false;
            addLog({
                 sender: i18n.t('headquarters'),
                 text: i18n.t('ai_messages.scanning_error', { name: b.name })
            });
            setBuildingsSyncTrigger(prev => prev + 1);
            onUpdateState({...stateRef.current});
        }
    },
    scavengeBuilding: (id: string) => {
        const b = buildingsRef.current.find(b => b.id === id);
        if (!b || !b.analysis) return;

        const now = Date.now();
        if (b.analysis.scavengeCooldownEnd && now < b.analysis.scavengeCooldownEnd) return;

        // Calculate Reward
        let reward = GAME_CONSTANTS.REWARD_PUBLIC;
        const type = b.type.toLowerCase();
        if (type.includes('industrial') || type.includes('factory') || type.includes('warehouse')) {
            reward = GAME_CONSTANTS.REWARD_INDUSTRIAL;
        } else if (type.includes('office') || type.includes('commercial') || type.includes('retail') || type.includes('mall')) {
            reward = GAME_CONSTANTS.REWARD_COMMERCIAL;
        } else if (type.includes('apartments') || type.includes('residential') || type.includes('house')) {
            reward = GAME_CONSTANTS.REWARD_RESIDENTIAL;
        }

        // Apply reward
        const currentState = stateRef.current;
        onUpdateState({
            ...currentState,
            resources: currentState.resources + reward
        });

        // Update building state
        b.analysis.scavengeCooldownEnd = now + GAME_CONSTANTS.COOLDOWN_SCAVENGE;
        b.analysis.scavengeCount = (b.analysis.scavengeCount || 0) + 1;

        // Log result
        addLog({
             sender: i18n.t('scavenge_team'),
             text: i18n.t('ai_messages.scavenge_result', { name: b.name, reward })
        });

        // Sync triggers
        setBuildingsSyncTrigger(prev => prev + 1);
        audioService.playSound(SoundType.DEPLOY_ACTION);
    }
  }));

  const fetchBuildings = useCallback((pos: Coordinates) => {
    mapDataService.getBuildingGeometries(pos).then(geoms => {
        // Merge and deduplicate
        const existingIds = new Set(buildingsRef.current.map(b => b.id));
        const newBuildings = geoms.filter(b => !existingIds.has(b.id));
        if (newBuildings.length > 0) {
            buildingsRef.current = [...buildingsRef.current, ...newBuildings];
            setBuildingsSyncTrigger(prev => prev + 1);

            // If population hasn't been initialized yet, and we have buildings, do it now
            if (!populationInitializedRef.current && buildingsRef.current.length > 0) {
                populationInitializedRef.current = true;
                initPopulation(pos, buildingsRef.current);
            }
        }
    });
  }, []);

  const [buildingsSyncTrigger, setBuildingsSyncTrigger] = useState(0);
  
  useEffect(() => {
      if (initialized && !isPaused) {
          audioService.startBGM();
      }
      return () => audioService.stopBGM();
  }, [initialized, isPaused]);

  useEffect(() => {
    const handleInit = (pos: Coordinates) => {
      setCenterPos(pos);
      // Don't init population here yet, wait for buildings
      fetchBuildings(pos);

      // Fallback: If no buildings are found after 3 seconds, init population anyway
      setTimeout(() => {
        if (!populationInitializedRef.current) {
          populationInitializedRef.current = true;
          initPopulation(pos, buildingsRef.current);
        }
      }, 3000);

      mapDataService.getLocationInfo(pos).then(info => {
        generateRadioChatter(stateRef.current, pos, 'START', info || undefined).then(text => {
           addLog({ sender: i18n.t('headquarters'), text });
        });
      });
    };

    if (initialCenter) {
      handleInit(initialCenter);
    } else {
      navigator.geolocation.getCurrentPosition(
        (pos) => handleInit({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          console.warn("Geolocation failed", err);
          handleInit(DEFAULT_LOCATION);
        }
      );
    }
  }, [initialCenter]);

  const initPopulation = (center: Coordinates, buildings: Building[]) => {
    const newEntities: GameEntity[] = [];
    
    // Pick an outbreak building first
    let outbreakTarget: Coordinates | null = null;
    if (buildings.length > 0) {
        const b = buildings[Math.floor(Math.random() * buildings.length)];
        outbreakTarget = b.geometry[0]; // Simplification for center
        setOutbreakPoint(outbreakTarget);
    } else {
        // Fallback for outbreak
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * GAME_CONSTANTS.SPAWN_RADIUS * 0.5;
        outbreakTarget = {
            lat: center.lat + r * Math.cos(angle),
            lng: center.lng + r * Math.sin(angle) * 0.8
        };
        setOutbreakPoint(outbreakTarget);
    }

    for (let i = 0; i < GAME_CONSTANTS.INITIAL_POPULATION; i++) {
      let spawnPos: Coordinates;
      const isIndoorPreference = Math.random() < GAME_CONSTANTS.BUILDING_STAY_CHANCE;
      const isIndoor = buildings.length > 0 && isIndoorPreference;
      
      if (isIndoor) {
          const b = buildings[Math.floor(Math.random() * buildings.length)];
          const vertex = b.geometry[Math.floor(Math.random() * b.geometry.length)];
          spawnPos = {
              lat: vertex.lat + (Math.random() - 0.5) * 0.0001,
              lng: vertex.lng + (Math.random() - 0.5) * 0.0001
          };
      } else {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * GAME_CONSTANTS.SPAWN_RADIUS;
          spawnPos = {
            lat: center.lat + r * Math.cos(angle),
            lng: center.lng + r * Math.sin(angle) * 0.8 
          };
      }
      
      const types = [CivilianType.MAN, CivilianType.WOMAN, CivilianType.CHILD, CivilianType.ELDERLY];
      const subType = types[Math.floor(Math.random() * types.length)];
      const isMale = subType === CivilianType.MAN || subType === CivilianType.ELDERLY || (subType === CivilianType.CHILD && Math.random() > 0.5);
      
      const entity: GameEntity = {
        id: `civ-${i}`,
        type: EntityType.CIVILIAN,
        subType,
        name: getRandomName(isMale),
        age: subType === CivilianType.CHILD ? 5 + Math.floor(Math.random()*10) : subType === CivilianType.ELDERLY ? 60 + Math.floor(Math.random()*30) : 18 + Math.floor(Math.random()*40),
        gender: isMale ? i18n.t('gender_male') : i18n.t('gender_female'),
        isMale,
        thought: '',
        position: spawnPos,
        velocity: { x: 0, y: 0 },
        wanderAngle: Math.random() * Math.PI * 2,
        isInfected: false,
        infectionRiskTimer: 0,
        isArmed: false,
        isDead: false,
        isTrapped: false,
        trappedTimer: 0,
        isMedic: false,
        healingTimer: 0,
        health: 10,
        isWanderer: Math.random() < GAME_CONSTANTS.WANDERER_CHANCE,
        panicTimer: 0
      };
      entity.thought = getRandomThought(entity, [], 0, buildings);
      newEntities.push(entity);
    }

    // Initial Zombies at Outbreak Point
    for(let i = 0; i < 3; i++) {
        const targetIdx = Math.floor(Math.random() * newEntities.length);
        const z = newEntities[targetIdx];
        z.type = EntityType.ZOMBIE;
        z.isInfected = true;
        z.health = 20; 
        z.thought = (i18n.t('thoughts.ZOMBIE', { returnObjects: true }) as string[])[0];
        
        // Move to outbreak point
        if (outbreakTarget) {
            z.position = { 
                lat: outbreakTarget.lat + (Math.random() - 0.5) * 0.0002,
                lng: outbreakTarget.lng + (Math.random() - 0.5) * 0.0002
            };
        }
    }

    entitiesRef.current = newEntities;
    setEntities(newEntities);

    // Async: Assign home locations from nearby features
    mapDataService.getNearbyFeatures(center).then(features => {
      if (features.length > 0) {
        const updated = entitiesRef.current.map(e => {
          if (e.type === EntityType.CIVILIAN && Math.random() < 0.4) {
            return { ...e, homeLocationName: features[Math.floor(Math.random() * features.length)] };
          }
          return e;
        });
        entitiesRef.current = updated;
        setEntities(updated);
      }
    });

    setInitialized(true);
  };

  // --- AI STEERING HELPERS ---
  const getSeparationForce = (entity: GameEntity, neighbors: GameEntity[]): Vector => {
    let steering: Vector = { x: 0, y: 0 };
    let count = 0;
    for (const other of neighbors) {
      if (other.isDead) continue; 
      const d = getVecDistance(entity.position, other.position);
      if (d > 0 && d < GAME_CONSTANTS.SEPARATION_RADIUS) {
        const diff = subVec({x: entity.position.lat, y: entity.position.lng}, {x: other.position.lat, y: other.position.lng});
        steering = addVec(steering, multVec(normalize(diff), 1/d));
        count++;
      }
    }
    if (count > 0) steering = multVec(normalize(steering), GAME_CONSTANTS.FORCE_SEPARATION);
    return steering;
  };

  const getSeekForce = (entity: GameEntity, target: Coordinates): Vector => {
    const desired = subVec({x: target.lat, y: target.lng}, {x: entity.position.lat, y: entity.position.lng});
    return multVec(normalize(desired), GAME_CONSTANTS.FORCE_SEEK);
  };

  const getFleeForce = (entity: GameEntity, threat: Coordinates): Vector => {
    const desired = subVec({x: entity.position.lat, y: entity.position.lng}, {x: threat.lat, y: threat.lng}); 
    return multVec(normalize(desired), GAME_CONSTANTS.FORCE_FLEE);
  };

  const getWanderForce = (entity: GameEntity): Vector => {
    entity.wanderAngle += (Math.random() - 0.5) * 0.5;
    return multVec({x: Math.cos(entity.wanderAngle), y: Math.sin(entity.wanderAngle)}, GAME_CONSTANTS.FORCE_WANDER);
  };

  // --- MAIN LOOP ---
  useEffect(() => {
    if (!initialized || stateRef.current.gameResult) return;

    const intervalId = setInterval(() => {
        // Multi-Tick Recovery
        tickRef.current++;

        // Process Strike Zones
        const now = Date.now();
        const activeStrikes = strikeZonesRef.current.filter(s => {
            const elapsed = now - s.startTime;
            
            // Play ticking sound every second
            if (elapsed > 0 && elapsed < s.duration && Math.floor(elapsed / 1000) !== Math.floor((elapsed - GAME_CONSTANTS.TICK_RATE) / 1000)) {
                audioService.playSound(SoundType.AIRSTRIKE_TICK);
            }

            if (elapsed >= s.duration) {
                // Strike impact!
                const victims = entitiesRef.current.filter(e => !e.isDead && getVecDistance(e.position, s.position) < s.radius);
                victims.forEach(v => {
                    v.isDead = true;
                    v.health = 0;
                });

                // Spawn Crater
                const crater: Crater = {
                    id: `crater-${Date.now()}`,
                    position: s.position,
                    radius: s.radius,
                    timestamp: now
                };
                cratersRef.current.push(crater);
                setCraters([...cratersRef.current]);

                // Explosion Effect
                const effect: VisualEffect = {
                    id: `strike-fx-${Date.now()}`,
                    type: 'EXPLOSION',
                    p1: s.position,
                    color: '#EF4444',
                    radius: s.radius * 2,
                    timestamp: now
                };
                setEffects(prev => [...prev, effect]);

                addLog({
                     sender: i18n.t('intel_center'),
                     text: i18n.t('airstrike_impact', { count: victims.length })
                });

                audioService.playSound(SoundType.WEAPON_ROCKET, true);
                return false; // Remove strike zone
            }
            return true;
        });

        if (activeStrikes.length !== strikeZonesRef.current.length) {
            strikeZonesRef.current = activeStrikes;
            setStrikeZones([...activeStrikes]);
        }
        const tick = tickRef.current;
        
        if (!pausedRef.current) {
            const allEntities = entitiesRef.current;
            const activeEntities = allEntities.filter(e => !e.isDead); 
            const zombies = activeEntities.filter(e => e.type === EntityType.ZOMBIE);
            const humans = activeEntities.filter(e => e.type !== EntityType.ZOMBIE);
            const newEffects: VisualEffect[] = [];
            const newlyDeadIds = new Set<string>();
            const curedIds = new Set<string>();
            const newlyInfectedIds = new Set<string>();
            
            // 1.1 MOVEMENT & BEHAVIOR
            activeEntities.forEach(entity => {
          // Trapped entities don't move
          if (entity.isTrapped) {
              entity.trappedTimer -= GAME_CONSTANTS.TICK_RATE;
              if (entity.trappedTimer <= 0) {
                  entity.isTrapped = false;
                  entity.thought = i18n.t('thoughts.ZOMBIE_ROAR'); // Angry roar on release
              } else {
                  // No movement
                  return;
              }
          }

          let acceleration: Vector = { x: 0, y: 0 };
          let maxSpeed = GAME_CONSTANTS.MAX_SPEED_CIVILIAN;
          
          // Collision & Physics Logic
          const isInside = buildingsRef.current.some(b => isPointInPolygon(entity.position, b.geometry));
          let penalty = 1.0;
          if (isInside) {
              if (entity.type === EntityType.SOLDIER || entity.isMedic) penalty = GAME_CONSTANTS.PENALTY_PROFESSIONAL;
              else if (entity.type === EntityType.ZOMBIE) penalty = GAME_CONSTANTS.PENALTY_ZOMBIE;
              else penalty = GAME_CONSTANTS.PENALTY_CIVILIAN;
          }

          // Boundary Transition Logic
          if (isInside !== entity.wasInsideBuilding) {
              // Only trigger for active entities to avoid dead people "crossing"
              if (Math.random() < 0.4) {
                  entity.moodIcon = MOOD_ICONS.CROSSING[Math.floor(Math.random() * MOOD_ICONS.CROSSING.length)];
                  entity.moodTimer = GAME_CONSTANTS.MOOD_DURATION;
                  const list = i18n.t('thoughts.CROSSING', { returnObjects: true }) as string[];
                  entity.thought = list[Math.floor(Math.random() * list.length)];
              }
              entity.wasInsideBuilding = isInside;
          }

          let nearbyThreats = 0;

          acceleration = addVec(acceleration, getSeparationForce(entity, activeEntities));
          const wanderForce = getWanderForce(entity);

          if (entity.type === EntityType.ZOMBIE) {
            let nearestHuman: GameEntity | null = null;
            let minDist = GAME_CONSTANTS.SMELL_RANGE_ZOMBIE;
            
            humans.forEach(h => {
              if (canSmell(entity, h) || canHear(entity, allEntities)) {
                const d = getVecDistance(entity.position, h.position);
                if (d < minDist) { minDist = d; nearestHuman = h; }
              }
            });

            if (nearestHuman) {
              acceleration = addVec(acceleration, getSeekForce(entity, nearestHuman.position));
              maxSpeed = GAME_CONSTANTS.MAX_SPEED_ZOMBIE * GAME_CONSTANTS.MULT_SPRINT;
            } else {
              acceleration = addVec(acceleration, wanderForce);
              maxSpeed = GAME_CONSTANTS.MAX_SPEED_ZOMBIE_IDLE;
            }
          } else if (entity.isMedic) {
             // MEDIC LOGIC
             maxSpeed = GAME_CONSTANTS.MAX_SPEED_SOLDIER;
             
             if (entity.healingTargetId) {
                 // Treating someone
                 const target = activeEntities.find(z => z.id === entity.healingTargetId);
                 if (!target || target.isDead || !target.isTrapped || (target.type as EntityType) !== EntityType.ZOMBIE) {
                     // Interrupted
                     entity.healingTargetId = undefined;
                     entity.healingTimer = 0;
                 } else {
                     const d = getVecDistance(entity.position, target.position);
                     if (d > 0.0002) { // Slightly larger distance to ensure contact
                         // Move to target
                         acceleration = addVec(acceleration, getSeekForce(entity, target.position));
                     } else {
                         // Heal
                      if (entity.healingTimer === 0) {
                          audioService.playSound(SoundType.HEAL_START);
                          onAddLog({ 
                              id: `heal-start-${Date.now()}-${entity.id}`, 
                              sender: `${i18n.t('medic')} ${entity.name}`, 
                               text: i18n.t('medic_treating'), 
                              timestamp: Date.now() 
                          });
                      }
                         entity.healingTimer += GAME_CONSTANTS.TICK_RATE;
                         if (entity.healingTimer >= GAME_CONSTANTS.HEAL_DURATION) {
                             // Cured!
                             curedIds.add(target.id);
                             target.isTrapped = false; // Release
                             entity.healingTargetId = undefined; // Done
                             entity.healingTimer = 0;
                              audioService.playSound(SoundType.HEAL_COMPLETE);
                              onAddLog({ 
                                  id: `heal-done-${Date.now()}-${entity.id}`, 
                                  sender: `${i18n.t('medic')} ${entity.name}`, 
                                   text: i18n.t('medic_finished'), 
                                  timestamp: Date.now() 
                              });
                         } else {
                             // Healing Effect
                             if (Math.random() < 0.2) {
                                 newEffects.push({
                                    id: `heal-${Date.now()}-${Math.random()}`,
                                    type: 'HEAL',
                                    p1: entity.position,
                                    p2: target.position,
                                    color: '#10B981', // Green
                                    timestamp: Date.now()
                                 });
                             }
                         }
                     }
                 }
             } else {
                 // Seek nearest trapped zombie
                 let nearestTrapped: GameEntity | null = null;
                 let minDist = 9999;
                 
                 zombies.forEach(z => {
                     if (z.isTrapped) {
                         const d = getVecDistance(entity.position, z.position);
                         if (d < minDist) { minDist = d; nearestTrapped = z; }
                     }
                 });

                 if (nearestTrapped) {
                     const d = getVecDistance(entity.position, nearestTrapped.position);
                     if (d < 0.0002) {
                         // Start Healing
                         entity.healingTargetId = nearestTrapped.id;
                         entity.healingTimer = 0;
                     } else {
                         acceleration = addVec(acceleration, getSeekForce(entity, nearestTrapped.position));
                     }
                 } else {
                     // Patrol with separation
                     acceleration = addVec(acceleration, wanderForce);
                 }
             }

          } else if (entity.type === EntityType.SOLDIER) {
            maxSpeed = GAME_CONSTANTS.MAX_SPEED_SOLDIER;
            let nearestZombie: GameEntity | null = null;
            let minDist = GAME_CONSTANTS.SATELLITE_VISION_RANGE;
            
            zombies.forEach(z => {
              // Professionals can see much further via satellite/comms, 
              // but still use vision/hearing for immediate tactical reaction
              if (canSee(entity, z, buildingsRef.current) || canHear(entity, allEntities) || getVecDistance(entity.position, z.position) < GAME_CONSTANTS.SATELLITE_VISION_RANGE) {
                const d = getVecDistance(entity.position, z.position);
                if (d < minDist) { minDist = d; nearestZombie = z; }
              }
            });

            if (nearestZombie) {
              nearbyThreats = 1;
              const distToZombie = minDist;
              const weaponRange = entity.weaponType ? WEAPON_STATS[entity.weaponType].range : WEAPON_STATS[WeaponType.PISTOL].range;
              const optimalRange = weaponRange * 0.8;

              // SNIPER BEHAVIOR: Keep Distance
              if (entity.weaponType === WeaponType.SNIPER && distToZombie < weaponRange * 0.5) {
                  // If too close, prioritize running away
                  acceleration = addVec(acceleration, multVec(getFleeForce(entity, nearestZombie.position), 2.0));
              } else {
                  if (distToZombie > optimalRange) acceleration = addVec(acceleration, getSeekForce(entity, nearestZombie.position));
                  else if (distToZombie < optimalRange * 0.4) acceleration = addVec(acceleration, getFleeForce(entity, nearestZombie.position));
                  else acceleration = addVec(acceleration, multVec(wanderForce, 0.5));
              }

            } else {
              acceleration = addVec(acceleration, wanderForce);
            }
          } else {
            // CIVILIAN
            let nearestZombie: GameEntity | null = null;
            let minDist = GAME_CONSTANTS.VISION_RANGE_OUTDOOR;
            zombies.forEach(z => {
              if (canSee(entity, z, buildingsRef.current) || canHear(entity, allEntities)) {
                const d = getVecDistance(entity.position, z.position);
                if (d < minDist) { minDist = d; nearestZombie = z; }
              }
            });

            if (nearestZombie) {
                nearbyThreats = 1;
                entity.panicTimer = GAME_CONSTANTS.PANIC_DURATION;
                acceleration = addVec(acceleration, getFleeForce(entity, nearestZombie.position));
                maxSpeed *= GAME_CONSTANTS.MULT_SPRINT;
            } else if (entity.panicTimer && entity.panicTimer > 0) {
                entity.panicTimer -= GAME_CONSTANTS.TICK_RATE;
                // Scared/Panic state but no zombie visible -> Seek nearest building (Hiding)
                if (!isInside) {
                    const nearestBuilding = getNearestBuilding(entity.position, buildingsRef.current);
                    if (nearestBuilding) {
                        acceleration = addVec(acceleration, getSeekForce(entity, nearestBuilding.geometry[0]));
                        maxSpeed *= GAME_CONSTANTS.MULT_SPRINT; 
                    } else {
                        acceleration = addVec(acceleration, wanderForce);
                    }
                } else {
                    // Already inside, just wander casually
                    acceleration = addVec(acceleration, multVec(getWanderForce(entity), 0.5));
                    maxSpeed *= 0.6;
                }
            } else if (stateRef.current.evacuationPoint) {
                // EVACUATION LOGIC
                const dToEvac = getVecDistance(entity.position, stateRef.current.evacuationPoint);
                if (dToEvac > 0.0002) {
                     acceleration = addVec(acceleration, getSeekForce(entity, stateRef.current.evacuationPoint));
                     maxSpeed *= 0.8; // Moving with purpose
                } else {
                     // Arrived at evac point, wander around
                     acceleration = addVec(acceleration, multVec(getWanderForce(entity), 0.2));
                     maxSpeed *= 0.3;
                }
            } else {
                // Calm state
                const shouldSeekIndoor = !entity.isWanderer && !isInside;
                if (shouldSeekIndoor) {
                    const nearestBuilding = getNearestBuilding(entity.position, buildingsRef.current);
                    if (nearestBuilding) {
                        acceleration = addVec(acceleration, getSeekForce(entity, nearestBuilding.geometry[0]));
                        maxSpeed *= 0.6; // Casually walking
                    } else {
                        acceleration = addVec(acceleration, wanderForce);
                    }
                } else if (isInside) {
                    // Slowly wander inside
                    acceleration = addVec(acceleration, multVec(getWanderForce(entity), 0.3));
                    maxSpeed *= 0.4;
                } else {
                    // Wanderer outside
                    acceleration = addVec(acceleration, wanderForce);
                    const distFromCenter = getVecDistance(entity.position, centerPos);
                    if (distFromCenter > GAME_CONSTANTS.SPAWN_RADIUS * 1.2) {
                        acceleration = addVec(acceleration, multVec(getSeekForce(entity, centerPos), 0.5));
                    }
                }
            }

            // Weapon Pickup Logic for Civilians
            if (entity.type === EntityType.CIVILIAN && !entity.isDead && !entity.isArmed) {
              const nearestWeapon = droppedWeaponsRef.current.find(w => 
                getVecDistance(entity.position, w.position) < GAME_CONSTANTS.VISION_RANGE_HUMAN
              );
              
              if (nearestWeapon) {
                const distToWeapon = getVecDistance(entity.position, nearestWeapon.position);
                if (distToWeapon < GAME_CONSTANTS.ITEM_PICKUP_RADIUS) {
                  // Pick up weapon
                  entity.isArmed = true;
                  entity.weaponType = nearestWeapon.type;
                  if (entity.weaponType === WeaponType.ROCKET) entity.ammo = GAME_CONSTANTS.ROCKET_AMMO_LIMIT;
                   const weaponName = i18n.t(`weapons.${entity.weaponType}`);
                   entity.thought = i18n.t('thoughts.PICKED_UP_WEAPON', { weaponName });
                  entity.moodIcon = "🔫";
                  entity.moodTimer = GAME_CONSTANTS.MOOD_DURATION;
                  
                  // Remove weapon from map
                  droppedWeaponsRef.current = droppedWeaponsRef.current.filter(w => w.id !== nearestWeapon.id);
                  setDroppedWeapons([...droppedWeaponsRef.current]);
                  
                  audioService.playSound(SoundType.UI_CLICK); 
                } else {
                  // Move towards weapon
                  acceleration = addVec(acceleration, multVec(getSeekForce(entity, nearestWeapon.position), 1.5));
                  maxSpeed *= GAME_CONSTANTS.MULT_SPRINT;
                }
              }
            }
          }

          if (Math.random() < 0.002) { 
            entity.thought = getRandomThought(entity, activeEntities, nearbyThreats, buildingsRef.current);
            
            // Random Civilian Sounds with Proximity Check & Demographic Data
            if (entity.type === EntityType.CIVILIAN && !entity.isDead) {
                const isPriority = entity.id === selectedIdRef.current;
                const distToCenter = getVecDistance(entity.position, centerPos);
                
                if (isPriority || distToCenter < 0.0015) {
                    const entityData = { 
                        gender: i18n.t(entity.gender === 'male' ? 'gender_male' : 'gender_female'), 
                        age: entity.age, 
                        isZombie: false 
                    };
                    
                    if (nearbyThreats > 0) {
                        audioService.playSound(
                            Math.random() < 0.7 ? SoundType.CIV_FEAR : SoundType.CIV_SCREAM, 
                            isPriority, 
                            entityData
                        );
                    } else if (entity.isArmed) {
                        audioService.playSound(
                            Math.random() < 0.5 ? SoundType.CIV_SHOUT : SoundType.CIV_URGE, 
                            isPriority, 
                            entityData
                        );
                    } else if (activeEntities.some(e => e.isMedic && getVecDistance(entity.position, e.position) < 0.0005)) {
                        if (Math.random() < 0.2) audioService.playSound(SoundType.CIV_CLAP, isPriority);
                    }
                }
            }
          }

          // Mood Logic
          if (entity.moodTimer && entity.moodTimer > 0) {
              entity.moodTimer -= GAME_CONSTANTS.TICK_RATE;
              if (entity.moodTimer <= 0) {
                  entity.moodIcon = undefined;
              }
          } else if (Math.random() < GAME_CONSTANTS.MOOD_CHANCE) {
              entity.moodIcon = getRandomMood(entity, nearbyThreats);
              entity.moodTimer = GAME_CONSTANTS.MOOD_DURATION;
          }

          entity.velocity = addVec(entity.velocity, acceleration);
          entity.velocity = limitVec(entity.velocity, maxSpeed * penalty);
          entity.position.lat += entity.velocity.x;
          entity.position.lng += entity.velocity.y;
        });

        // 1.1b-2 BACKGROUND LOCATION UPDATE
        if (tick % 40 === 0 && activeEntities.length > 0) {
          const updateTarget = activeEntities[Math.floor(Math.random() * activeEntities.length)];
          mapDataService.getLocationInfo(updateTarget.position).then(info => {
              if (info) {
                updateTarget.currentLocationName = info.name;
                updateTarget.locationMetadata = info;
              }
          });
        }

        // 1.1b RANDOM RADIO CHATTER
        if (Math.random() < 0.015) { 
            const channelUsers = activeEntities.filter(e => e.type === EntityType.SOLDIER || (e.type === EntityType.CIVILIAN && e.isArmed));
            if (channelUsers.length > 0) {
                const chatterSource = channelUsers[Math.floor(Math.random() * channelUsers.length)];
                let senderPrefix = chatterSource.isMedic ? i18n.t('medic') : chatterSource.type === EntityType.SOLDIER ? i18n.t('specops') : i18n.t('armed_civilian');
                
                mapDataService.getLocationInfo(chatterSource.position).then(info => {
                    if (info) {
                        chatterSource.currentLocationName = info.name;
                        chatterSource.locationMetadata = info;
                    }
                    
                    generateRadioChatter(stateRef.current, chatterSource.position, 'RANDOM', info || undefined).then(text => {
                        addLog({
                          sender: `${senderPrefix} ${chatterSource.name}`,
                          senderId: chatterSource.id,
                          text
                        });
                    });
                });
            }
        }

        // 1.1c ZOMBIE DISCOVERY
        if (zombies.length > 0 && !discoveryRef.current) {
            discoveryRef.current = true;
            stateRef.current.infectionDetected = true;

            // Trigger initial preparation countdowns
            const now = Date.now();
            stateRef.current.cooldowns = {
                ...stateRef.current.cooldowns,
                [ToolType.SUPPLY_DROP]: now + GAME_CONSTANTS.COOLDOWN_SUPPLY,
                [ToolType.SPEC_OPS]: now + GAME_CONSTANTS.COOLDOWN_SPECOPS,
                [ToolType.MEDIC_TEAM]: now + GAME_CONSTANTS.COOLDOWN_MEDIC,
                [ToolType.AIRSTRIKE]: now + GAME_CONSTANTS.COOLDOWN_AIRSTRIKE
            };

            const targetZ = zombies[0];
            mapDataService.getLocationInfo(targetZ.position).then(info => {
                generateRadioChatter(stateRef.current, targetZ.position, 'DISCOVERY', info || undefined).then(text => {
                    addLog({
                        sender: i18n.t('headquarters'), // Using Headquarters for the discovery message as well for authority
                        text
                    });
                    
                    // Specific command from Headquarters
                    setTimeout(() => {
                        addLog({
                            sender: i18n.t('headquarters'),
                            text: "各单位注意，现在开始紧急准备任务！"
                        });
                    }, 1000);
                });
            });

            // Sync state immediately
            onUpdateState({ ...stateRef.current });
        }
        
        // Continuous Infection Logic
        humans.forEach(h => {
            if (newlyDeadIds.has(h.id)) return;

            let isExposed = false;
            // Check against all zombies
            for (const z of zombies) {
                 // Only untrapped, alive zombies can infect
                 if (z.isTrapped || newlyDeadIds.has(z.id)) continue;
                 
                 if (getVecDistance(z.position, h.position) < GAME_CONSTANTS.INFECTION_RANGE) {
                     isExposed = true;
                     break; // Found one threat, that's enough to be accumulating risk
                 }
            }

            if (isExposed) {
                h.infectionRiskTimer += GAME_CONSTANTS.TICK_RATE;
                // Periodic biting sound while nearby - reduced frequency
                if (Math.random() < 0.01) {
                    audioService.playSound(SoundType.ZOM_BITE, h.id === selectedIdRef.current);
                }
                if (h.infectionRiskTimer >= GAME_CONSTANTS.INFECTION_DURATION) {
                    // Infection Complete
                    newlyInfectedIds.add(h.id);
                    // Zombie Sound on infection
                    audioService.playSound(SoundType.ZOM_ROAR, h.id === selectedIdRef.current);
                }
            } else {
                // Safe, reset timer immediately
                h.infectionRiskTimer = 0;
            }
        });

        // Combat Logic: Sort shooters by priority
        // 1. Net Gun (Control) 
        // 2. Pistol (Backup/Common)
        // 3. Shotgun (Close quarters)
        // 4. Sniper (Long Range)
        // 5. Rocket (Last Resort/Splash)
        const shooters = humans.filter(h => h.isArmed || h.type === EntityType.SOLDIER);
        const weaponPriority = {
            [WeaponType.NET_GUN]: 1,
            [WeaponType.PISTOL]: 2,
            [WeaponType.SHOTGUN]: 3,
            [WeaponType.SNIPER]: 4,
            [WeaponType.ROCKET]: 5
        };
        
        shooters.sort((a, b) => {
            const wA = a.weaponType || WeaponType.PISTOL;
            const wB = b.weaponType || WeaponType.PISTOL;
            return weaponPriority[wA] - weaponPriority[wB];
        });

        shooters.forEach(shooter => {
          if (shooter.isMedic || newlyInfectedIds.has(shooter.id)) return;

          const weaponType = shooter.weaponType || WeaponType.PISTOL;
          const stats = WEAPON_STATS[weaponType];
          const isPriority = shooter.id === selectedIdRef.current;
          
          // Do not target zombies that are already trapped
          const targets = zombies.filter(z => !newlyDeadIds.has(z.id) && !z.isTrapped && getVecDistance(shooter.position, z.position) < stats.range);
          
          if (targets.length > 0) {
            const fireProb = shooter.type === EntityType.SOLDIER ? 0.2 : 0.1; 
            
            // SNIPER LOGIC: Cooldown & Fleeing
            if (weaponType === WeaponType.SNIPER) {
                 // Cooldown Check
                 const now = Date.now();
                 if (shooter.lastFiredTime && now - shooter.lastFiredTime < GAME_CONSTANTS.SNIPER_COOLDOWN) {
                     return; // Cooldown active, cannot shoot
                 }

                 const nearestZ = targets.reduce((prev, curr) => 
                    getVecDistance(shooter.position, prev.position) < getVecDistance(shooter.position, curr.position) ? prev : curr
                 );
                 if (getVecDistance(shooter.position, nearestZ.position) < stats.range * 0.4) {
                     // Too close, focus on running, don't shoot
                     return; 
                 }
            }

            if (Math.random() < fireProb) {
              
              // Check Ammo for Rocket
              if (weaponType === WeaponType.ROCKET) {
                  if ((shooter.ammo || 0) <= 0) {
                      // Out of ammo, switch to Pistol
                      shooter.weaponType = WeaponType.PISTOL;
                       shooter.thought = i18n.t('thoughts.OUT_OF_ROCKETS');
                      return; 
                  }
              }

              let sType = SoundType.WEAPON_PISTOL;
              if (weaponType === WeaponType.SHOTGUN) sType = SoundType.WEAPON_SHOTGUN;
              else if (weaponType === WeaponType.SNIPER) sType = SoundType.WEAPON_SNIPER;
              else if (weaponType === WeaponType.ROCKET) sType = SoundType.WEAPON_ROCKET;
              else if (weaponType === WeaponType.NET_GUN) sType = SoundType.WEAPON_NET;
              

              if (weaponType === WeaponType.ROCKET) {
                  // Smart Rocket Logic
                  // 1. Find clusters
                  // 2. Check for friendly fire
                  const explosionRadius = (stats as any).splashRadius || 0.0005;
                  
                  // Find best target (most zombies in radius)
                  let bestTarget: GameEntity | null = null;
                  let maxHits = 0;

                  for (const cand of targets) {
                       let hits = 0;
                       let friendlyHits = 0;
                       activeEntities.forEach(e => {
                           if (getVecDistance(e.position, cand.position) <= explosionRadius) {
                               if (e.type === EntityType.ZOMBIE) hits++;
                               else friendlyHits++;
                           }
                       });

                       // SAFETY CHECK: Don't fire if friendlies are in splash zone
                       if (friendlyHits === 0 && hits > maxHits) {
                           maxHits = hits;
                           bestTarget = cand;
                       }
                  }

                  // Only fire if we hit a decent cluster (>= 2 zombies) and it's safe, or if it's the only option and safe
                  if (bestTarget && (maxHits >= 2 || targets.length === 1)) {
                      shooter.ammo = (shooter.ammo || 0) - 1;
                      audioService.playSound(sType, isPriority);
                      onAddLog({ 
                          id: `rocket-fire-${Date.now()}-${shooter.id}`, 
                          sender: `${i18n.t('specops')} ${shooter.name}`, 
                           text: i18n.t('rocket_launched'), 
                          timestamp: Date.now() 
                      });
                      
                      newEffects.push({
                        id: `ex-${Date.now()}-${Math.random()}`,
                        type: 'EXPLOSION',
                        p1: bestTarget.position,
                        color: stats.color,
                        radius: explosionRadius,
                        timestamp: Date.now()
                      });
                      newEffects.push({
                        id: `rocket-${Date.now()}-${Math.random()}`,
                        type: 'SHOT',
                        p1: shooter.position,
                        p2: bestTarget.position,
                        color: stats.color,
                        timestamp: Date.now()
                      });

                      activeEntities.forEach(e => {
                        if (getVecDistance(e.position, bestTarget!.position) <= explosionRadius) {
                          e.health -= stats.damage;
                          if (e.health <= 0) {
                              newlyDeadIds.add(e.id);
                              if (e.type !== EntityType.ZOMBIE) {
                                  // FRIENDLY FIRE LOG
                                  onAddLog({
                                      id: `ff-${Date.now()}`,
                                       sender: i18n.t('headquarters'),
                                       text: i18n.t('friendly_fire_warning', { name: e.name }),
                                      timestamp: Date.now()
                                  });
                              }
                          }
                        }
                      });
                  } else {
                      // Unsafe to fire or bad target, hold fire (or maybe flee)
                  }

              } else if (weaponType === WeaponType.NET_GUN) {
                   // Prioritize untrapped zombies
                   const untrappedTargets = targets.filter(t => !t.isTrapped);
                   const target = untrappedTargets.length > 0 
                        ? untrappedTargets[Math.floor(Math.random() * untrappedTargets.length)]
                        : targets[Math.floor(Math.random() * targets.length)];

                   if (!target.isTrapped) { 
                       lastCombatTickRef.current = tickRef.current;
                       audioService.playSound(sType, isPriority);
                       target.isTrapped = true;
                       target.trappedTimer = GAME_CONSTANTS.NET_DURATION;
                       onAddLog({ 
                           id: `net-fire-${Date.now()}-${shooter.id}`, 
                           sender: `${i18n.t('specops')} ${shooter.name}`, 
                            text: i18n.t('target_netted'), 
                           timestamp: Date.now() 
                       });
                       newEffects.push({
                            id: `net-${Date.now()}-${Math.random()}`,
                            type: 'SHOT',
                            p1: shooter.position,
                            p2: target.position,
                            color: stats.color,
                            timestamp: Date.now()
                       });
                   }
              } else if (weaponType === WeaponType.SHOTGUN) {
                  lastCombatTickRef.current = tickRef.current;
                  audioService.playSound(sType, isPriority);
                  const nearbyTargets = targets.slice(0, 3); 
                  nearbyTargets.forEach(target => {
                    target.health -= stats.damage;
                    newEffects.push({
                      id: `shot-${Date.now()}-${Math.random()}`,
                      type: 'SHOT',
                      p1: shooter.position,
                      p2: target.position,
                      color: stats.color,
                      timestamp: Date.now()
                    });
                    if (target.health <= 0) newlyDeadIds.add(target.id);
                    else if (Math.random() < 0.15) audioService.playSound(SoundType.ZOM_FIGHT);
                  });

              } else {
                // Pistol / Sniper
                lastCombatTickRef.current = tickRef.current;
                audioService.playSound(sType, isPriority);
                
                const target = targets[Math.floor(Math.random() * targets.length)];
                
                // Set cooldown for sniper
                 if (weaponType === WeaponType.SNIPER) {
                     shooter.lastFiredTime = Date.now();
                     if (Math.random() < 0.3) {
                         onAddLog({ 
                             id: `sniper-fire-${Date.now()}-${shooter.id}`, 
                             sender: `${i18n.t('sniper_prefix')} ${shooter.name}`, 
                              text: i18n.t('sniper_kill_log', { dist: Math.floor(getVecDistance(shooter.position, target.position) * 100000) }), 
                             timestamp: Date.now() 
                         });
                     }
                 }

                target.health -= stats.damage;
                newEffects.push({
                    id: `shot-${Date.now()}-${Math.random()}`,
                    type: 'SHOT',
                    p1: shooter.position,
                    p2: target.position,
                    color: stats.color,
                    timestamp: Date.now()
                });
                if (target.health <= 0) newlyDeadIds.add(target.id);
                else if (Math.random() < 0.15) audioService.playSound(SoundType.ZOM_FIGHT);
              }
            }
          }
        });

        // 1.3 PROCESS STATE CHANGES (Deaths, Cures, Infections)
        allEntities.forEach(e => {
            if (newlyInfectedIds.has(e.id)) {
                // INFECTED
                const isSoldier = e.type === EntityType.SOLDIER;
                e.type = EntityType.ZOMBIE;
                e.isInfected = true;
                e.health = (isSoldier ? 50 : 20);
                e.thought = (i18n.t('thoughts.ZOMBIE', { returnObjects: true }) as string[])[0];
                e.isArmed = false;
                e.isMedic = false;
                e.infectionRiskTimer = 0;
                e.weaponType = undefined; // Drop weapon
                e.ammo = 0;
            }
            else if (curedIds.has(e.id)) {
                // CURE LOGIC
                e.type = EntityType.CIVILIAN;
                e.isInfected = false;
                e.health = 10;
                e.isTrapped = false;
                e.infectionRiskTimer = 0;
                e.thought = (i18n.t('thoughts.MEDIC', { returnObjects: true }) as string[])[0];
                audioService.playSound(SoundType.HEAL_COMPLETE, e.id === selectedIdRef.current);
            }
            else if (newlyDeadIds.has(e.id)) {
                e.health = 0;
                e.isDead = true;
                e.thought = (i18n.t('thoughts.CORPSE', { returnObjects: true }) as string[])[0];
                e.isMedic = false; // Medic dies
                e.healingTargetId = undefined;
                e.isTrapped = false;
            }
        });

        entitiesRef.current = allEntities; 
        setEntities([...entitiesRef.current]);
        
        setEffects(prev => [...prev.filter(e => now - e.timestamp < 200), ...newEffects]);
      } 

      // --- 2. STATE SYNC ---
      const currentEntities = entitiesRef.current;
      stateRef.current.infectedCount = currentEntities.filter(e => !e.isDead && e.type === EntityType.ZOMBIE).length;
      stateRef.current.soldierCount = currentEntities.filter(e => !e.isDead && e.type === EntityType.SOLDIER).length;
      stateRef.current.healthyCount = currentEntities.filter(e => !e.isDead && e.type === EntityType.CIVILIAN).length;

      stateRef.current.selectedEntity = selectedIdRef.current 
          ? currentEntities.find(e => e.id === selectedIdRef.current) || null
          : null;
          
      stateRef.current.selectedBuilding = selectedBuildingIdRef.current 
          ? buildingsRef.current.find(b => b.id === selectedBuildingIdRef.current) || null
          : null;

      if (stateRef.current.infectedCount === 0 && stateRef.current.healthyCount > 0 && !victoryAnnouncedRef.current) {
          stateRef.current.gameResult = 'VICTORY';
          victoryAnnouncedRef.current = true;
          mapDataService.getLocationInfo(centerPos).then(info => {
            generateRadioChatter(stateRef.current, centerPos, 'WAVE_CLEARED', info || undefined).then(text => {
              addLog({ sender: i18n.t('president'), text });
            });
          });
      }
      else if (stateRef.current.healthyCount === 0 && stateRef.current.soldierCount === 0) {
          stateRef.current.gameResult = 'DEFEAT';
      }
      
      // Low health warning
      if (stateRef.current.healthyCount < GAME_CONSTANTS.INITIAL_POPULATION * 0.2 && !lowHealthAnnouncedRef.current) {
          lowHealthAnnouncedRef.current = true;
          mapDataService.getLocationInfo(centerPos).then(info => {
            generateRadioChatter(stateRef.current, centerPos, 'LOW_HEALTH', info || undefined).then(text => {
              addLog({ sender: i18n.t('intel_analyst'), text });
            });
          });
      }

      onUpdateState({...stateRef.current});

      // --- 1.4 BGM DYNAMIC SWITCHING ---
      if (!pausedRef.current && !stateRef.current.gameResult) {
          const activeEntities = entitiesRef.current.filter(e => !e.isDead);
          const armedUnits = activeEntities.filter(e => e.type === EntityType.SOLDIER || (e.type === EntityType.CIVILIAN && e.isArmed));
          const zombies = activeEntities.filter(e => e.type === EntityType.ZOMBIE);
          
          const totalActive = activeEntities.length;
          const zombieRatio = totalActive > 0 ? zombies.length / totalActive : 0;
          
          let newState = BGMState.SAFE;
          
          if (armedUnits.length > 0) {
              newState = BGMState.COMBAT;
          } else if (zombieRatio > 0.3) {
              newState = BGMState.DANGER;
          } else {
              newState = BGMState.SAFE;
          }
          
          audioService.setBGMState(newState);
      } else if (stateRef.current.gameResult) {
          audioService.stopBGM();
      }

    }, GAME_CONSTANTS.TICK_RATE);

    return () => clearInterval(intervalId);
  }, [initialized, centerPos, onUpdateState, strikeZonesRef]);

  // --- PLAYER INPUT ---
  const handleMapClick = (latlng: L.LatLng) => {
    if (stateRef.current.gameResult || pausedRef.current) return;
    
    onEntitySelect(null);
    onBuildingSelect(null);

    const clickPos = { lat: latlng.lat, lng: latlng.lng };
    
    const checkCooldown = (tool: ToolType, duration: number): boolean => {
        const now = Date.now();
        const end = stateRef.current.cooldowns[tool] || 0;
        if (now < end) {
             onAddLog({ id: Date.now().toString(), sender: i18n.t('system'), text: i18n.t('cooldown_active'), timestamp: Date.now() });
             audioService.playSound(SoundType.UI_ERROR, true);
             return false;
        }
        stateRef.current.cooldowns[tool] = now + duration;
        return true;
    };

    const useResource = (cost: number) => {
      if (stateRef.current.resources >= cost) {
        stateRef.current.resources -= cost;
        return true;
      }
      audioService.playSound(SoundType.UI_ERROR, true);
      onAddLog({ id: Date.now().toString(), sender: i18n.t('system'), text: i18n.t('insufficient_funds'), timestamp: Date.now() });
      return false;
    };

    if (selectedTool === ToolType.AIRSTRIKE) {
        if (useResource(GAME_CONSTANTS.COST_AIRSTRIKE) && checkCooldown(ToolType.AIRSTRIKE, GAME_CONSTANTS.COOLDOWN_AIRSTRIKE)) {
            audioService.playSound(SoundType.DEPLOY_ACTION, true);
            
            const strike: StrikeZone = {
                id: `strike-${Date.now()}`,
                position: { lat: latlng.lat, lng: latlng.lng },
                radius: GAME_CONSTANTS.AIRSTRIKE_RADIUS,
                startTime: Date.now(),
                duration: 5000
            };

            strikeZonesRef.current.push(strike);
            setStrikeZones([...strikeZonesRef.current]);

            addLog({
                sender: i18n.t('headquarters'),
                text: i18n.t('airstrike_confirmed')
            });
            
            audioService.playSound(SoundType.DEPLOY_ACTION);
            onSelectTool(ToolType.NONE);
        }
    } else if (selectedTool === ToolType.SUPPLY_DROP) {
        if (useResource(GAME_CONSTANTS.COST_SUPPLY) && checkCooldown(ToolType.SUPPLY_DROP, GAME_CONSTANTS.COOLDOWN_SUPPLY)) {
            audioService.playSound(SoundType.DEPLOY_ACTION, true);
            
            // Spawn 3 random weapons in the area
            const newWeapons: WeaponItem[] = [];
            for (let i = 0; i < 3; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * GAME_CONSTANTS.SUPPLY_RADIUS;
                newWeapons.push({
                    id: `weapon-${Date.now()}-${i}`,
                    type: getRandomWeapon(),
                    position: {
                        lat: clickPos.lat + r * Math.cos(angle),
                        lng: clickPos.lng + r * Math.sin(angle)
                    },
                    timestamp: Date.now()
                });
            }
            
            droppedWeaponsRef.current = [...droppedWeaponsRef.current, ...newWeapons];
            setDroppedWeapons(droppedWeaponsRef.current);
            
            addLog({ 
                sender: i18n.t('system'), 
                text: i18n.t('weapon_drop_ready') 
            });
            
            onSelectTool(ToolType.NONE);
        }

    } else if (selectedTool === ToolType.SPEC_OPS) {
        if (useResource(GAME_CONSTANTS.COST_SPEC_OPS) && checkCooldown(ToolType.SPEC_OPS, GAME_CONSTANTS.COOLDOWN_SPECOPS)) {
            audioService.playSound(SoundType.DEPLOY_ACTION, true);
            for(let i=0; i<4; i++) {
               // Spec Ops Loadout: Rocket, Sniper, or Net Gun
               const rand = Math.random();
               let wType = WeaponType.SNIPER;
               if (rand < 0.4) wType = WeaponType.ROCKET;
               else if (rand < 0.7) wType = WeaponType.NET_GUN;
               
               entitiesRef.current.push({
                 id: `specops-${Date.now()}-${i}`,
                 type: EntityType.SOLDIER,
                 name: getRandomName(true),
                 age: 20 + Math.floor(Math.random() * i),
                 gender: i18n.t('gender_male'),
                 thought: (i18n.t('thoughts.SOLDIER', { returnObjects: true }) as string[])[0],
                 position: { lat: clickPos.lat + (Math.random()*0.0001), lng: clickPos.lng + (Math.random()*0.0001) },
                 velocity: { x: 0, y: 0 },
                 wanderAngle: Math.random() * Math.PI * 2,
                 isInfected: false,
                 infectionRiskTimer: 0,
                 isArmed: true,
                 isDead: false,
                 isTrapped: false,
                 trappedTimer: 0,
                 isMedic: false,
                 healingTimer: 0,
                 weaponType: wType,
                 ammo: wType === WeaponType.ROCKET ? GAME_CONSTANTS.ROCKET_AMMO_LIMIT : undefined,
                 health: 50
               });
            }
            mapDataService.getLocationInfo(clickPos).then(info => {
              generateRadioChatter(stateRef.current, clickPos, 'RESCUE', info || undefined).then(text => {
                const locName = info?.name || i18n.t('unknown_area');
                addLog({ sender: i18n.t('specops'), text: i18n.t('specops_arrived', { text, locName }) });
              });
            });
            onSelectTool(ToolType.NONE);
        }
    } else if (selectedTool === ToolType.MEDIC_TEAM) {
        if (useResource(GAME_CONSTANTS.COST_MEDIC) && checkCooldown(ToolType.MEDIC_TEAM, GAME_CONSTANTS.COOLDOWN_MEDIC)) {
            audioService.playSound(SoundType.DEPLOY_ACTION, true);
            for(let i=0; i<2; i++) { // Deploy 2 medics
               entitiesRef.current.push({
                 id: `medic-${Date.now()}-${i}`,
                 type: EntityType.CIVILIAN,
                 isMedic: true,
                 name: getRandomName(true),
                 age: 30 + Math.floor(Math.random() * i),
                 gender: i18n.t('gender_male'),
                 thought: (i18n.t('thoughts.MEDIC', { returnObjects: true }) as string[])[0],
                 position: { lat: clickPos.lat + (Math.random()*0.0001), lng: clickPos.lng + (Math.random()*0.0001) },
                 velocity: { x: 0, y: 0 },
                 wanderAngle: Math.random() * Math.PI * 2,
                 isInfected: false,
                 infectionRiskTimer: 0,
                 isArmed: false, // Medics don't shoot
                 isDead: false,
                 isTrapped: false,
                 trappedTimer: 0,
                 healingTimer: 0,
                 weaponType: undefined,
                 health: 30
               });
            }
             onAddLog({ id: Date.now().toString(), sender: i18n.t('medic_team'), text: i18n.t('medic_team_ready'), timestamp: Date.now() });
            onSelectTool(ToolType.NONE);
        }
    } else if (selectedTool === ToolType.BROADCAST_ANNOUNCEMENT) {
        stateRef.current.evacuationPoint = clickPos;
        audioService.playSound(SoundType.CIV_ALARM);
        
        // Fetch location names for the radio message
        Promise.all([
            mapDataService.getLocationInfo(outbreakPoint || clickPos),
            mapDataService.getLocationInfo(clickPos)
        ]).then(([infInfo, evacInfo]) => {
            const infectionLoc = infInfo?.name || i18n.t('unknown_area');
            const evacLoc = evacInfo?.name || i18n.t('unknown_area');
            
            addLog({
                sender: i18n.t('city_council'),
                text: i18n.t('broadcast_msg', { infectionLoc, evacLoc })
            });
        });
        
        onUpdateState({ ...stateRef.current });
        onSelectTool(ToolType.NONE);
    }
  };

  if (!initialized) return <div className="flex h-full w-full items-center justify-center bg-black text-green-500 font-mono text-xl animate-pulse">{i18n.t('loading_satellite')}</div>;

  return (
    <MapContainer 
      center={[centerPos.lat, centerPos.lng]} 
      zoom={18} 
      zoomControl={false}
      scrollWheelZoom={true}
      doubleClickZoom={false}
      className={`h-full w-full z-0 bg-gray-900 ${selectedTool === ToolType.SUPPLY_DROP || selectedTool === ToolType.AIRSTRIKE || selectedTool === ToolType.BROADCAST_ANNOUNCEMENT ? 'cursor-none' : 'cursor-crosshair'}`}
    >
      <TileLayer
        attribution='&copy; OSM'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles"
      />
      <MapEvents 
        onMapClick={handleMapClick} 
        onDrag={onCancelFollow} 
        onMoveEnd={fetchBuildings} 
        onMouseMove={setMousePos}
      />

      {/* Tool Cursors */}
      {mousePos && selectedTool === ToolType.SUPPLY_DROP && (
          <Circle 
              center={[mousePos.lat, mousePos.lng]} 
              radius={GAME_CONSTANTS.SUPPLY_RADIUS * 111320} // approx convert degrees to meters for Leaflet
              pathOptions={{ dashArray: '5, 10', color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 0.1 }}
          />
      )}
      {mousePos && selectedTool === ToolType.AIRSTRIKE && (
          <Circle 
              center={[mousePos.lat, mousePos.lng]} 
              radius={GAME_CONSTANTS.AIRSTRIKE_RADIUS * 111320}
              pathOptions={{ dashArray: '5, 10', color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.1 }}
          />
      )}
      {mousePos && selectedTool === ToolType.BROADCAST_ANNOUNCEMENT && (
          <Circle 
              center={[mousePos.lat, mousePos.lng]} 
              radius={0.0005 * 111320} // Just a visual guide
              pathOptions={{ dashArray: '5, 10', color: '#22C55E', fillColor: '#22C55E', fillOpacity: 0.1 }}
          />
      )}

      {/* Craters - Rendered in a separate pane to stay under UI elements */}
      <Pane name="crater-pane" style={{ zIndex: 350 }}>
          {craters.map(c => (
              <Marker 
                  key={c.id}
                  position={[c.position.lat, c.position.lng]}
                  pane="crater-pane"
                  icon={L.divIcon({
                      className: 'bg-transparent',
                      html: `
                           <div style="
                               width: ${c.radius * 222640}px; 
                               height: ${c.radius * 222640}px; 
                               background: radial-gradient(circle, #374151 0%, #374151 20%, rgba(0, 0, 0, 0) 100%);
                               border-radius: 50%;
                               transform: translate(-50%, -50%);
                               overflow: hidden;
                           ">
                                ${Array.from({length: 8}).map((_, i) => {
                                    // Seeded random for stable cracks
                                    const seed = c.id + i;
                                    let h = 0;
                                    for (let j = 0; j < seed.length; j++) h = (Math.imul(31, h) + seed.charCodeAt(j)) | 0;
                                    const seededRandom = () => {
                                        h = (Math.imul(h, 48271) % 2147483647);
                                        return (h - 1) / 2147483646;
                                    };

                                    const angle = (i * 45) + (seededRandom() * 20 - 10);
                                    const opacity = 0.3 + seededRandom() * 0.4;
                                    const length = 40 + seededRandom() * 20;
                                    const delay = seededRandom() * 2;
                                    return `
                                        <div style="
                                            position: absolute;
                                            top: 50%;
                                            left: 50%;
                                            width: ${length}%;
                                            height: 2px;
                                            background: rgba(0,0,0,${opacity});
                                            transform-origin: left center;
                                            transform: rotate(${angle}deg);
                                            clip-path: polygon(0% 0%, 100% 50%, 0% 100%);
                                            animation: crack-opacity 3s ease-in-out infinite;
                                            animation-delay: ${delay}s;
                                        "></div>
                                    `;
                                }).join('')}
                           </div>
                           <style>
                                @keyframes crack-opacity {
                                    0%, 100% { opacity: 0.8; }
                                    50% { opacity: 0.2; }
                                }
                           </style>
                       `,
                      iconSize: [0, 0],
                      iconAnchor: [0, 0]
                  })}
                  interactive={false}
              />
          ))}
      </Pane>

      {/* Strike Zones */}
      {strikeZones.map(s => {
          const elapsed = Date.now() - s.startTime;
          const remaining = Math.max(0, Math.ceil((s.duration - elapsed) / 1000));
          const isFlashing = (Math.floor(elapsed / 250) % 2 === 0);
          
          return (
              <div key={s.id}>
                  <Circle 
                      center={[s.position.lat, s.position.lng]} 
                      radius={s.radius * 111320}
                      pathOptions={{ 
                          color: isFlashing ? '#EF4444' : '#FBBF24', 
                          fillColor: '#EF4444', 
                          fillOpacity: 0.2,
                          weight: 3
                      }}
                  />
                  <Marker 
                      position={[s.position.lat, s.position.lng]}
                      icon={L.divIcon({
                          className: 'bg-transparent',
                          html: `
                              <div class="flex flex-col items-center justify-center gap-2 w-full h-full">
                                     <div class="bg-red-600 text-white px-4 py-1.5 text-xl font-black rounded shadow-xl animate-pulse">
                                       ${remaining}${i18n.t('sec_suffix')}
                                     </div>
                                     <div class="text-red-500 font-black whitespace-nowrap text-lg drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] animate-pulse">
                                       ${i18n.t('warning_airstrike')}
                                     </div>
                              </div>
                          `,
                          iconSize: [200, 100],
                          iconAnchor: [100, 50]
                      })}
                      interactive={false}
                  />
              </div>
          );
      })}
      
      {/* Evacuation Point Marker */}
      {stateRef.current.evacuationPoint && (
          <Marker 
              position={[stateRef.current.evacuationPoint.lat, stateRef.current.evacuationPoint.lng]}
              icon={L.divIcon({
                  className: 'bg-transparent',
                  html: `
                      <div class="evac-marker">
                          <div class="evac-icon">🏠</div>
                          <div class="evac-pulse"></div>
                      </div>
                      <style>
                          .evac-marker {
                              position: relative;
                              display: flex;
                              align-items: center;
                              justify-content: center;
                              width: 40px;
                              height: 40px;
                          }
                          .evac-icon {
                              font-size: 32px;
                              z-index: 10;
                              filter: drop-shadow(0 0 10px rgba(34, 197, 94, 0.8));
                              animation: evac-bounce 2s ease-in-out infinite;
                          }
                          .evac-pulse {
                              position: absolute;
                              width: 100%;
                              height: 100%;
                              background: rgba(34, 197, 94, 0.4);
                              border-radius: 50%;
                              animation: evac-pulse 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
                          }
                          @keyframes evac-bounce {
                              0%, 100% { transform: translateY(0) scale(1); }
                              50% { transform: translateY(-5px) scale(1.1); }
                          }
                          @keyframes evac-pulse {
                              0% { transform: scale(0.5); opacity: 1; }
                              100% { transform: scale(2.5); opacity: 0; }
                          }
                      </style>
                  `,
                  iconSize: [40, 40],
                  iconAnchor: [20, 20]
              })}
              zIndexOffset={900}
              interactive={false}
          />
      )}

      {/* Outbreak Point Marker */}
      {outbreakPoint && (
          <Marker 
              position={[outbreakPoint.lat, outbreakPoint.lng]}
              icon={L.divIcon({
                  className: 'bg-transparent',
                  html: `
                      <div class="outbreak-marker">
                          <div class="outbreak-icon">☣️</div>
                          <div class="outbreak-pulse"></div>
                      </div>
                      <style>
                          .outbreak-marker {
                              position: relative;
                              display: flex;
                              align-items: center;
                              justify-content: center;
                              width: 40px;
                              height: 40px;
                          }
                          .outbreak-icon {
                              font-size: 32px;
                              z-index: 10;
                              filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.8));
                              animation: outbreak-bounce 2s ease-in-out infinite;
                          }
                          .outbreak-pulse {
                              position: absolute;
                              width: 100%;
                              height: 100%;
                              background: rgba(239, 68, 68, 0.4);
                              border-radius: 50%;
                              animation: outbreak-pulse 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
                          }
                          @keyframes outbreak-bounce {
                              0%, 100% { transform: translateY(0) scale(1); }
                              50% { transform: translateY(-5px) scale(1.1); }
                          }
                          @keyframes outbreak-pulse {
                              0% { transform: scale(0.5); opacity: 1; }
                              100% { transform: scale(2.5); opacity: 0; }
                          }
                      </style>
                  `,
                  iconSize: [40, 40],
                  iconAnchor: [20, 20]
              })}
              zIndexOffset={1000}
              interactive={false}
          />
      )}
      
      {/* Buildings Layer */}
      {buildingsRef.current.map(b => (
        <Polygon
          key={b.id}
          positions={b.geometry.map(p => [p.lat, p.lng] as [number, number])}
          pathOptions={{
            color: b.id === selectedBuildingId ? '#FACC15' : '#94A3B8',
            weight: b.id === selectedBuildingId ? 3 : 1,
            fillColor: b.id === selectedBuildingId ? '#FACC15' : '#475569',
            fillOpacity: b.id === selectedBuildingId ? 0.4 : 0.2,
            className: 'building-polygon'
          }}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              if (selectedTool === ToolType.NONE) {
                onBuildingSelect(b.id === selectedBuildingId ? null : b.id);
                audioService.playSound(SoundType.UI_SELECT);
              }
            }
          }}
        />
      ))}

      {/* Weapons Layer */}
      {droppedWeapons.map(w => (
        <WeaponMarker key={w.id} weapon={w} />
      ))}

      <LocateController followingEntityId={followingEntityId} entities={entities} onCancelFollow={onCancelFollow} />
      
      {effects.map(ef => {
        if (ef.type === 'SHOT' && ef.p2) {
            return (
              <Polyline 
                key={ef.id}
                positions={[[ef.p1.lat, ef.p1.lng], [ef.p2.lat, ef.p2.lng]]}
                pathOptions={{ color: ef.color, weight: ef.color === '#2DD4BF' ? 1 : ef.color === '#EF4444' ? 3 : 1, opacity: 0.8, dashArray: ef.color === '#2DD4BF' ? '5,5' : undefined }}
              />
            );
        } else if (ef.type === 'EXPLOSION' && ef.radius) {
            return (
               <Circle 
                 key={ef.id}
                 center={[ef.p1.lat, ef.p1.lng]}
                 radius={ef.radius * 100000}
                 pathOptions={{ color: ef.color, fillColor: ef.color, fillOpacity: 0.5, stroke: false }}
               />
            );
        } else if (ef.type === 'HEAL' && ef.p2) {
             return (
              <Polyline 
                key={ef.id}
                positions={[[ef.p1.lat, ef.p1.lng], [ef.p2.lat, ef.p2.lng]]}
                pathOptions={{ color: ef.color, weight: 2, opacity: 0.6 }}
              />
            );
        }
        return null;
      })}

      {entities.map(e => (
        <EntityMarker 
          key={e.id} 
          entity={e} 
          lat={e.position.lat}
          lng={e.position.lng}
          isSelected={e.id === selectedEntityId} 
          onSelect={onEntitySelect} 
          isDead={e.isDead}
          isTrapped={e.isTrapped}
          isInfected={e.isInfected}
        />
      ))}
    </MapContainer>
  );
});

export default GameMap;
