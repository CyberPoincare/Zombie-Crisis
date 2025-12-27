
import React, { useEffect, useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, Circle, Polygon, Pane } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, EntityType, CivilianType, GameEntity, GameState, RadioMessage, ToolType, Vector, WeaponType, VisualEffect, SoundType, Building, BGMState, WeaponItem, StrikeZone, Crater } from '../types';
import { GAME_CONSTANTS, DEFAULT_LOCATION, CHINESE_SURNAMES, CHINESE_GIVEN_NAMES_MALE, CHINESE_GIVEN_NAMES_FEMALE, THOUGHTS, WEAPON_STATS, WEAPON_SYMBOLS, MOOD_ICONS } from '../constants';
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

// --- Helpers ---
const getRandomName = (isMale: boolean) => {
  const surname = CHINESE_SURNAMES[Math.floor(Math.random() * CHINESE_SURNAMES.length)];
  const givenNames = isMale ? CHINESE_GIVEN_NAMES_MALE : CHINESE_GIVEN_NAMES_FEMALE;
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
  return surname + givenName;
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

const getRandomThought = (entity: GameEntity, neighbors: GameEntity[], nearbyZombies: number) => {
  if (entity.isDead) return THOUGHTS.CORPSE[0];
  if (entity.isTrapped) return THOUGHTS.ZOMBIE_TRAPPED[Math.floor(Math.random() * THOUGHTS.ZOMBIE_TRAPPED.length)];
  if (entity.isMedic) return THOUGHTS.MEDIC[Math.floor(Math.random() * THOUGHTS.MEDIC.length)];

  let pool: string[] = [];
  
  if (entity.type === EntityType.ZOMBIE) {
    pool = THOUGHTS.ZOMBIE;
  } else if (entity.type === EntityType.SOLDIER) {
    const nearbyArmedCiv = neighbors.find(n => n.type === EntityType.CIVILIAN && n.isArmed && getVecDistance(entity.position, n.position) < 0.001);
    
    const meta = entity.locationMetadata;
    if (meta && Math.random() < 0.3) {
      const road = meta.road || '这条路';
      const feat = meta.feature;
      const locs = [
          `正在通过${road}，推进中。`,
          `在${road}发现敌情，准备战斗。`,
          feat ? `检查${feat}周边。` : `搜索附近建筑。`,
          `这里是${entity.currentLocationName}，报告完毕。`
      ];
      return locs[Math.floor(Math.random() * locs.length)];
    }

    if (nearbyArmedCiv && Math.random() < 0.3) {
        pool = THOUGHTS.SOLDIER_COMPLAINT;
    } else {
        pool = THOUGHTS.SOLDIER;
    }
  } else {
      // Civilian
      const meta = entity.locationMetadata;
      if (meta && Math.random() < 0.45) {
        const road = meta.road || '这条路';
        const feat = meta.feature;
        const sub = meta.suburb;

        const locs = [
          `我就在${entity.currentLocationName}这儿，怪物越来越多了...`,
          `${entity.currentLocationName}现在到处都是火，太可怕了。`,
          `得赶紧离开${road}，前面好像堵住了。`,
          `这里是${entity.currentLocationName}吗？我已经彻底迷路了...`,
          feat ? `能在${feat}找个地方躲躲吗？` : `该找个结实的建筑躲起来...`,
          sub ? `不知道${sub}那边的撤离点还在不在。` : `指挥中心，收到请回答！`
        ];
        return locs[Math.floor(Math.random() * locs.length)];
      }

      if (entity.homeLocationName && Math.random() < 0.15) {
        const homes = [
          `我家就住${entity.homeLocationName}附近，不知道那边怎么样了。`,
          `我想回${entity.homeLocationName}看看...`,
          `希望能回${entity.homeLocationName}拿点东西。`
        ];
        return homes[Math.floor(Math.random() * homes.length)];
      }

      // Proximity checks for reactive thoughts
      const SEARCH_DIST = 0.002;
      const zombiesVeryClose = neighbors.filter(n => n.type === EntityType.ZOMBIE && getVecDistance(entity.position, n.position) < 0.001);
      const nearbySoldiers = neighbors.filter(n => n.type === EntityType.SOLDIER && getVecDistance(entity.position, n.position) < SEARCH_DIST);
      const nearbyMedics = neighbors.filter(n => n.isMedic && getVecDistance(entity.position, n.position) < SEARCH_DIST);

      if (zombiesVeryClose.length > 0 && Math.random() < 0.6) {
          pool = THOUGHTS.CIVILIAN_SEE_ZOMBIE_CLOSE;
      } else if (nearbyMedics.length > 0 && Math.random() < 0.4) {
          pool = THOUGHTS.CIVILIAN_SEE_MEDIC;
      } else if (nearbySoldiers.length > 0 && Math.random() < 0.4) {
          pool = THOUGHTS.CIVILIAN_SEE_SOLDIER;
      } else {
          const thoughtRoll = Math.random();
          if (thoughtRoll < 0.2) {
              pool = THOUGHTS.CIVILIAN_MEMORIES;
          } else if (thoughtRoll < 0.4) {
              pool = THOUGHTS.CIVILIAN_SURVIVAL;
          } else if (entity.isArmed) {
              pool = Math.random() < 0.5 ? THOUGHTS.ARMED_CIVILIAN : THOUGHTS.CIVILIAN_ARMED;
          } else if (nearbyZombies > 0) {
              pool = THOUGHTS.CIVILIAN_PANIC;
          } else {
              pool = THOUGHTS.CIVILIAN_CALM;
          }
      }
    }
    return pool[Math.floor(Math.random() * pool.length)];
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
  } else if (entity.type === EntityType.SOLDIER) {
    colorClass = 'bg-blue-500 border border-white';
    effectClass = 'shadow-[0_0_5px_rgba(59,130,246,0.8)]';
    if (entity.isMedic) {
        colorClass = 'bg-white border border-red-500';
        innerContent = '<div class="text-[8px] text-red-600 flex items-center justify-center font-bold leading-none h-full">+</div>';
    } else if (entity.weaponType) {
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
  if (entity.type === EntityType.CIVILIAN) {
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
  const { selectedTool, onSelectTool, isPaused, onUpdateState, onAddLog, initialState, selectedEntityId, onEntitySelect, selectedBuildingId, onBuildingSelect, followingEntityId, onCancelFollow } = props;
  const [centerPos, setCenterPos] = useState<Coordinates>(DEFAULT_LOCATION);
  const [entities, setEntities] = useState<GameEntity[]>([]);
  const [effects, setEffects] = useState<VisualEffect[]>([]); 
  const [droppedWeapons, setDroppedWeapons] = useState<WeaponItem[]>([]);
  const [mousePos, setMousePos] = useState<Coordinates | null>(null);
  const [strikeZones, setStrikeZones] = useState<StrikeZone[]>([]);
  const [craters, setCraters] = useState<Crater[]>([]);
  const [initialized, setInitialized] = useState(false);
  
  const entitiesRef = useRef<GameEntity[]>([]);
  const droppedWeaponsRef = useRef<WeaponItem[]>([]);
  const strikeZonesRef = useRef<StrikeZone[]>([]);
  const cratersRef = useRef<Crater[]>([]);
  const stateRef = useRef<GameState>({ ...initialState, droppedWeapons: [] });
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
    const type = b.type.toLowerCase();
    const isCommercial = type.includes('office') || type.includes('commercial') || type.includes('retail') || type.includes('mall');
    const isResidential = type.includes('apartments') || type.includes('residential') || type.includes('house');
    const isIndustrial = type.includes('industrial') || type.includes('factory') || type.includes('warehouse');
    const isPublic = type.includes('hospital') || type.includes('university') || type.includes('school');

    if (isResidential) {
        guide = "该建筑属于生活居住区。周边街道错综复杂，适合打游击战。建议检查楼顶是否有撤离通道。交通情况：巷道狭窄，大型车辆难以进入。";
    } else if (isCommercial) {
        guide = "商业办公区。玻璃幕墙较多，防御性较弱，但视野极佳。周边通常为开阔地带，容易遭到包围。交通情况：主干道环绕，撤离速度快，但容易堵塞。";
    } else if (isIndustrial) {
        guide = "工业仓储区。结构极其稳固，适合长期固守。内部有大量大型设备可作为掩体。交通情况：多货运通道，适合重型装备部署。";
    } else if (isPublic) {
        guide = "关键公共设施。内部空间巨大且复杂，医疗物资丰富。战术价值极高。交通情况：设有紧急调度通道，是理想的直升机降落点。";
    } else {
        guide = "标准城市建筑。结构通用，无特殊防御加成。周边环境复杂。交通情况：随处可见的街区通道，机动性适中。";
    }

    // Tactical Analysis (Current real-time data)
    let tactical = "";
    if (zombies > 10) {
        tactical = `警告：当前区域僵尸数量极其密集（${zombies}个）。建筑已被包围，建议立即请求空袭支援或特种突击队进行斩首行动。`;
    } else if (zombies > 0) {
        tactical = `注意：周边侦测到${zombies}个感染者。目前压力适中，平民在专业人员掩护下可尝试向外围移动。`;
    } else {
        tactical = "当前建筑周边暂时安全。无感染者活动。建议抓紧时间加固防线或搜集物资。";
    }

    if (soldiers > 0) {
        tactical += ` 目前该区域有${soldiers}名专业作战人员提供火力覆盖。`;
    }
    if (civilians > 0) {
        tactical += ` 建筑内及周边发现${civilians}名平民。`;
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
            sender: '指挥部',
            text: `正在启动对 ${b.name} 的深度扫描，请稍候...`
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
                    sender: '指挥部',
                    text: `警告：目标区域 ${b.name} 的地理元数据载入失败。将使用本地缓存及战术基准数据进行分析。`
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
            addLog({
                sender: '战术分析AI',
                text: `对 ${b.name} 的深度扫描已完成。数据已同步，注意查收生存指南。`
            });
            
            // Sync triggers
            setBuildingsSyncTrigger(prev => prev + 1);
            onUpdateState({...stateRef.current});
        } catch (error) {
            console.error("Tactical Analysis Error:", error);
            if (b.analysis) b.analysis.isAnalyzing = false;
            addLog({
                sender: '指挥部',
                text: `对 ${b.name} 的扫描请求遇到技术障碍。`
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
            sender: '搜救队',
            text: `从 ${b.name} 搜寻到了价值 $${reward} 的物资。`
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
            // Trigger re-render by updating entities or a dummy state if needed,
            // but since buildings are rendered from ref in the return, 
            // we might need a state to trigger React to refresh the Polygon list.
            setBuildingsSyncTrigger(prev => prev + 1);
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const startPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenterPos(startPos);
        initPopulation(startPos);
        setInitialized(true);

        // Fetch initial buildings
        fetchBuildings(startPos);

        mapDataService.getLocationInfo(startPos).then(info => {
          generateRadioChatter(stateRef.current, startPos, 'START', info || undefined).then(text => {
            addLog({ sender: '指挥部', text });
          });
        });
      },
      (err) => {
        console.warn("Geolocation failed", err);
        const startPos = DEFAULT_LOCATION;
        initPopulation(startPos);
        setInitialized(true);
        mapDataService.getLocationInfo(startPos).then(info => {
          generateRadioChatter(stateRef.current, startPos, 'START', info || undefined).then(text => {
            addLog({ sender: '指挥部', text });
          });
        });
      }
    );
  }, []);

  const initPopulation = (center: Coordinates) => {
    const newEntities: GameEntity[] = [];
    
    for (let i = 0; i < GAME_CONSTANTS.INITIAL_POPULATION; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * GAME_CONSTANTS.SPAWN_RADIUS;
      
      const types = [CivilianType.MAN, CivilianType.WOMAN, CivilianType.CHILD, CivilianType.ELDERLY];
      const subType = types[Math.floor(Math.random() * types.length)];
      const isMale = subType === CivilianType.MAN || subType === CivilianType.ELDERLY || (subType === CivilianType.CHILD && Math.random() > 0.5);
      
      const entity: GameEntity = {
        id: `civ-${i}`,
        type: EntityType.CIVILIAN,
        subType,
        name: getRandomName(isMale),
        age: subType === CivilianType.CHILD ? 5 + Math.floor(Math.random()*10) : subType === CivilianType.ELDERLY ? 60 + Math.floor(Math.random()*30) : 18 + Math.floor(Math.random()*40),
        gender: isMale ? '男' : '女',
        thought: '',
        position: {
          lat: center.lat + r * Math.cos(angle),
          lng: center.lng + r * Math.sin(angle) * 0.8 
        },
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
        health: 10
      };
      entity.thought = getRandomThought(entity, [], 0);
      newEntities.push(entity);
    }

    for(let i = 0; i < 3; i++) {
        const targetIdx = Math.floor(Math.random() * newEntities.length);
        const z = newEntities[targetIdx];
        z.type = EntityType.ZOMBIE;
        z.isInfected = true;
        z.health = 20; 
        z.thought = THOUGHTS.ZOMBIE[0];
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
                    sender: '战术指挥中心',
                    text: `打击波次已到达。确认摧毁半径内所有目标 (${victims.length} 名)。区域环境已遭受结构性损毁。`
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
                  entity.thought = "吼！！！"; // Angry roar on release
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
                  entity.thought = THOUGHTS.CROSSING[Math.floor(Math.random() * THOUGHTS.CROSSING.length)];
              }
              entity.wasInsideBuilding = isInside;
          }

          let nearbyThreats = 0;

          acceleration = addVec(acceleration, getSeparationForce(entity, activeEntities));
          const wanderForce = getWanderForce(entity);

          if (entity.type === EntityType.ZOMBIE) {
            maxSpeed = GAME_CONSTANTS.MAX_SPEED_ZOMBIE;
            let nearestHuman: GameEntity | null = null;
            let minDist = GAME_CONSTANTS.VISION_RANGE_ZOMBIE;
            
            humans.forEach(h => {
              const d = getVecDistance(entity.position, h.position);
              if (d < minDist) { minDist = d; nearestHuman = h; }
            });

            if (nearestHuman) {
              acceleration = addVec(acceleration, getSeekForce(entity, nearestHuman.position));
              maxSpeed *= GAME_CONSTANTS.MULT_SPRINT;
            } else {
              acceleration = addVec(acceleration, wanderForce);
              maxSpeed *= GAME_CONSTANTS.MULT_WANDER;
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
                              sender: `医疗兵 ${entity.name}`, 
                              senderId: entity.id,
                              text: `正在对目标进行应急处置，掩护我！`, 
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
                                  sender: `医疗兵 ${entity.name}`, 
                                  senderId: entity.id,
                                  text: `治疗完成！该市民已恢复意识。正在寻找下一个生还者。`, 
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
            let minDist = GAME_CONSTANTS.VISION_RANGE_HUMAN * 2;
            
            zombies.forEach(z => {
              const d = getVecDistance(entity.position, z.position);
              if (d < minDist) { minDist = d; nearestZombie = z; }
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
            let minDist = GAME_CONSTANTS.VISION_RANGE_HUMAN;
            zombies.forEach(z => {
              const d = getVecDistance(entity.position, z.position);
              if (d < minDist) { minDist = d; nearestZombie = z; nearbyThreats++; }
            });

            if (nearestZombie) {
              const panicThreshold = entity.isArmed ? minDist * 0.5 : minDist;
              if (getVecDistance(entity.position, nearestZombie.position) < panicThreshold) {
                  acceleration = addVec(acceleration, getFleeForce(entity, nearestZombie.position));
                  maxSpeed *= GAME_CONSTANTS.MULT_SPRINT;
              } else if (entity.isArmed) {
                  acceleration = addVec(acceleration, multVec(getFleeForce(entity, nearestZombie.position), 0.2));
              }
            } else {
              acceleration = addVec(acceleration, wanderForce);
              const distFromCenter = getVecDistance(entity.position, centerPos);
              if (distFromCenter > GAME_CONSTANTS.SPAWN_RADIUS * 1.2) {
                acceleration = addVec(acceleration, multVec(getSeekForce(entity, centerPos), 0.5));
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
                  entity.thought = `拿到了${WEAPON_STATS[entity.weaponType].name}！跟它们拼了！`;
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
            entity.thought = getRandomThought(entity, activeEntities, nearbyThreats);
            
            // Random Civilian Sounds with Proximity Check & Demographic Data
            if (entity.type === EntityType.CIVILIAN && !entity.isDead) {
                const isPriority = entity.id === selectedIdRef.current;
                const distToCenter = getVecDistance(entity.position, centerPos);
                
                if (isPriority || distToCenter < 0.0015) {
                    const entityData = { 
                        gender: entity.gender, 
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
        // Throttled: only update location once every 40 ticks (~2 seconds)
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
                let senderPrefix = chatterSource.isMedic ? "医疗兵" : chatterSource.type === EntityType.SOLDIER ? "特专队员" : "武装市民";
                
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
            const targetZ = zombies[0];
            mapDataService.getLocationInfo(targetZ.position).then(info => {
                generateRadioChatter(stateRef.current, targetZ.position, 'DISCOVERY', info || undefined).then(text => {
                    addLog({
                        sender: '情报中心',
                        text
                    });
                });
            });
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
                      shooter.thought = "没火箭弹了！换手枪！";
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
                          sender: `队员 ${shooter.name}`, 
                          senderId: shooter.id,
                          text: `火箭弹发射！由于爆炸范围大，所有人闪避！`, 
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
                                      sender: "指挥部",
                                      text: `！！！警告：${e.name} 被友军火箭弹击中。停止无差别开火！`,
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
                           sender: `队员 ${shooter.name}`, 
                           senderId: shooter.id,
                           text: `目标已捕获！医疗组快跟上！`, 
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
                             sender: `狙击手 ${shooter.name}`, 
                             senderId: shooter.id,
                             text: `距离 ${Math.floor(getVecDistance(shooter.position, target.position) * 100000)}米，风速修正完成。目标已击中。`, 
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
                e.thought = "吼...";
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
                e.thought = "我...我感觉好多了...";
                audioService.playSound(SoundType.HEAL_COMPLETE, e.id === selectedIdRef.current);
            }
            else if (newlyDeadIds.has(e.id)) {
                e.isDead = true;
                e.velocity = {x: 0, y: 0}; 
                e.thought = THOUGHTS.CORPSE[0];
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
              addLog({ sender: '总统', text });
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
              addLog({ sender: '情报分析员', text });
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
             onAddLog({ id: Date.now().toString(), sender: '系统', text: '行动冷却中...', timestamp: Date.now() });
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
      onAddLog({ id: Date.now().toString(), sender: '系统', text: '资金不足', timestamp: Date.now() });
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
                sender: '指挥部',
                text: `收到。空袭计划已确认，战机预计5秒后抵达目标区域。所有友军立即撤离！`
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
                sender: '系统', 
                text: `武器空投已就绪。正在目标区域投放 3 件装备，请求幸存者就近夺取。` 
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
                 id: `soldier-${Date.now()}-${i}`,
                 type: EntityType.SOLDIER,
                 name: getRandomName(true),
                 age: 20 + Math.floor(Math.random() * i),
                 gender: '男',
                 thought: THOUGHTS.SOLDIER[0],
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
                addLog({ sender: '特种部队', text: `${text} 小队已在 ${info?.name || '指定区域'} 降落。` });
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
                 type: EntityType.SOLDIER, // Uses soldier movement stats
                 name: getRandomName(true),
                 age: 30 + Math.floor(Math.random() * i),
                 gender: '男',
                 thought: THOUGHTS.MEDIC[0],
                 position: { lat: clickPos.lat + (Math.random()*0.0001), lng: clickPos.lng + (Math.random()*0.0001) },
                 velocity: { x: 0, y: 0 },
                 wanderAngle: Math.random() * Math.PI * 2,
                 isInfected: false,
                 infectionRiskTimer: 0,
                 isArmed: false, // Medics don't shoot
                 isDead: false,
                 isTrapped: false,
                 trappedTimer: 0,
                 isMedic: true,
                 healingTimer: 0,
                 weaponType: undefined,
                 health: 30
               });
            }
            onAddLog({ id: Date.now().toString(), sender: '医疗组', text: "医疗小组已就位，寻找目标中...", timestamp: Date.now() });
            onSelectTool(ToolType.NONE);
        }
    }
  };

  if (!initialized) return <div className="flex h-full w-full items-center justify-center bg-black text-green-500 font-mono text-xl animate-pulse">卫星数据载入中...</div>;

  return (
    <MapContainer 
      center={[centerPos.lat, centerPos.lng]} 
      zoom={18} 
      zoomControl={false}
      scrollWheelZoom={true}
      doubleClickZoom={false}
      className={`h-full w-full z-0 bg-gray-900 ${selectedTool === ToolType.SUPPLY_DROP || selectedTool === ToolType.AIRSTRIKE ? 'cursor-none' : 'cursor-crosshair'}`}
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
                              <div class="flex flex-col items-center justify-center">
                                  <div class="text-red-500 font-black text-2xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] animate-pulse">
                                      ${remaining}秒
                                  </div>
                                  <div class="text-white text-[10px] font-bold bg-red-600 px-2 py-0.5 rounded animate-bounce whitespace-nowrap">
                                      警告：空中打击
                                  </div>
                              </div>
                          `,
                          iconSize: [120, 60],
                          iconAnchor: [60, 30]
                      })}
                      interactive={false}
                  />
              </div>
          );
      })}
      
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
