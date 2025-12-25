
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, Circle } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, EntityType, CivilianType, GameEntity, GameState, RadioMessage, ToolType, Vector, WeaponType, VisualEffect, SoundType } from '../types';
import { GAME_CONSTANTS, DEFAULT_LOCATION, CHINESE_SURNAMES, CHINESE_GIVEN_NAMES_MALE, CHINESE_GIVEN_NAMES_FEMALE, THOUGHTS, WEAPON_STATS, WEAPON_SYMBOLS } from '../constants';
import { generateRadioChatter } from '../services/geminiService';
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

      if (entity.isArmed) {
        pool = Math.random() < 0.5 ? THOUGHTS.ARMED_CIVILIAN : THOUGHTS.CIVILIAN_ARMED;
      } else if (nearbyZombies > 0) {
        pool = THOUGHTS.CIVILIAN_PANIC;
      } else {
        pool = THOUGHTS.CIVILIAN_CALM;
      }
    }
    return pool[Math.floor(Math.random() * pool.length)];
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

  return L.divIcon({
    className: 'bg-transparent',
    html: `<div class="${colorClass} ${shapeClass} ${size} ${effectClass} ${ringClass} transition-all duration-300 relative overflow-hidden">${innerContent}</div>`,
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
    [entity.type, entity.subType, entity.isArmed, entity.isInfected, entity.isDead, entity.isTrapped, entity.isMedic, entity.weaponType, entity.infectionRiskTimer, isSelected]
  );

  return (
    <Marker 
      position={[lat, lng]} 
      icon={icon}
      eventHandlers={eventHandlers}
      zIndexOffset={entity.isDead ? -100 : 0} 
    />
  );
});

interface GameMapProps {
  selectedTool: ToolType;
  isPaused: boolean;
  onUpdateState: (state: GameState) => void;
  onAddLog: (msg: RadioMessage) => void;
  initialState: GameState;
  selectedEntityId: string | null;
  onEntitySelect: (id: string | null) => void;
  followingEntityId: string | null;
  onCancelFollow: () => void;
}

const MapEvents: React.FC<{ onMapClick: (latlng: L.LatLng) => void, onDrag: () => void }> = ({ onMapClick, onDrag }) => {
  useMapEvents({
    click(e) { onMapClick(e.latlng); },
    dragstart() { onDrag(); },
    movestart(e) { 
        if (e.hard) return; // ignore programatic
        const originalEvent = (e as any).originalEvent;
        if (originalEvent) onDrag(); // only if user triggered
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

const GameMap: React.FC<GameMapProps> = ({ selectedTool, isPaused, onUpdateState, onAddLog, initialState, selectedEntityId, onEntitySelect, followingEntityId, onCancelFollow }) => {
  const [centerPos, setCenterPos] = useState<Coordinates>(DEFAULT_LOCATION);
  const [entities, setEntities] = useState<GameEntity[]>([]);
  const [effects, setEffects] = useState<VisualEffect[]>([]); 
  const [initialized, setInitialized] = useState(false);
  
  const entitiesRef = useRef<GameEntity[]>([]);
  const stateRef = useRef<GameState>(initialState);
  const pausedRef = useRef(isPaused);
  const selectedIdRef = useRef(selectedEntityId);
  const discoveryRef = useRef(false);
  const victoryAnnouncedRef = useRef(false);
  const lowHealthAnnouncedRef = useRef(false);
  const logCounterRef = useRef(0);
  const getUniqueId = () => `${Date.now()}-${logCounterRef.current++}`;

  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { selectedIdRef.current = selectedEntityId; }, [selectedEntityId]);

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
          }

          if (Math.random() < 0.02) { 
            entity.thought = getRandomThought(entity, activeEntities, nearbyThreats);
          }

          entity.velocity = addVec(entity.velocity, acceleration);
          entity.velocity = limitVec(entity.velocity, maxSpeed);
          entity.position.lat += entity.velocity.x;
          entity.position.lng += entity.velocity.y;
        });

        // 1.1b-2 BACKGROUND LOCATION UPDATE
        if (activeEntities.length > 0) {
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
                if (h.infectionRiskTimer >= GAME_CONSTANTS.INFECTION_DURATION) {
                    // Infection Complete
                    newlyInfectedIds.add(h.id);
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
                      audioService.playSound(sType);
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
                       audioService.playSound(sType);
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
                  audioService.playSound(sType);
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
                  });

              } else {
                // Pistol / Sniper
                audioService.playSound(sType);
                
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
        
        const now = Date.now();
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

    }, GAME_CONSTANTS.TICK_RATE);

    return () => clearInterval(intervalId);
  }, [initialized, centerPos, onUpdateState]); 

  // --- PLAYER INPUT ---
  const handleMapClick = (latlng: L.LatLng) => {
    if (stateRef.current.gameResult || pausedRef.current) return;

    onEntitySelect(null);

    const clickPos = { lat: latlng.lat, lng: latlng.lng };
    
    const checkCooldown = (tool: ToolType, duration: number): boolean => {
        const now = Date.now();
        const end = stateRef.current.cooldowns[tool] || 0;
        if (now < end) {
             onAddLog({ id: Date.now().toString(), sender: '系统', text: '行动冷却中...', timestamp: Date.now() });
             audioService.playSound(SoundType.UI_ERROR);
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
      audioService.playSound(SoundType.UI_ERROR);
      onAddLog({ id: Date.now().toString(), sender: '系统', text: '资金不足', timestamp: Date.now() });
      return false;
    };

    if (selectedTool === ToolType.AIRSTRIKE) {
        if (useResource(GAME_CONSTANTS.COST_AIRSTRIKE) && checkCooldown(ToolType.AIRSTRIKE, GAME_CONSTANTS.COOLDOWN_AIRSTRIKE)) {
            audioService.playSound(SoundType.DEPLOY_ACTION);
            const killedEntities: {id: string, name: string, type: EntityType}[] = [];
            // Friendly Fire: Airstrike kills ANY entity in range
            entitiesRef.current.forEach(e => {
              if (!e.isDead && getVecDistance(e.position, clickPos) < GAME_CONSTANTS.AIRSTRIKE_RADIUS) {
                e.isDead = true;
                e.isTrapped = false;
                e.velocity = {x:0, y:0};
                e.thought = THOUGHTS.CORPSE[0];
                killedEntities.push({id: e.id, name: e.name, type: e.type});
              }
            });

            const ffTargets = killedEntities.filter(k => k.type !== EntityType.ZOMBIE);
            if (ffTargets.length > 0) {
                onAddLog({
                    id: `ff-air-${Date.now()}`,
                    sender: "系统",
                    text: `[严重警告] 误伤发生：${ffTargets.map(t => t.name).join(', ')} 在空袭中丧生。`,
                    timestamp: Date.now()
                });
            }
            audioService.playSound(SoundType.WEAPON_ROCKET); 
            const pilotChatter = [
                `打击确认。目标区域已覆盖。`,
                `已投弹。地面部队请确认毁伤情况。`,
                `这里是猎鹰-1，导弹已离架，正脱离目标区。`,
                `目标已锁定，地狱火已发射。`
            ];
            const text = pilotChatter[Math.floor(Math.random() * pilotChatter.length)];
            onAddLog({ id: Date.now().toString(), sender: '飞行员', text: `${text} 消灭 ${killedEntities.length} 个目标（含误伤）。`, timestamp: Date.now() });
        }
    } else if (selectedTool === ToolType.SUPPLY_DROP) {
        if (useResource(GAME_CONSTANTS.COST_SUPPLY) && checkCooldown(ToolType.SUPPLY_DROP, GAME_CONSTANTS.COOLDOWN_SUPPLY)) {
            audioService.playSound(SoundType.DEPLOY_ACTION);
            const candidates = entitiesRef.current.filter(e => 
              !e.isDead && e.type === EntityType.CIVILIAN && !e.isInfected && getVecDistance(e.position, clickPos) < GAME_CONSTANTS.SUPPLY_RADIUS
            );
            
            const luckySurvivors = candidates.sort(() => 0.5 - Math.random()).slice(0, 4);
            
            luckySurvivors.forEach(e => {
               e.isArmed = true;
               e.weaponType = getRandomWeapon();
               if (e.weaponType === WeaponType.ROCKET) e.ammo = GAME_CONSTANTS.ROCKET_AMMO_LIMIT;
               e.thought = `拿到了${WEAPON_STATS[e.weaponType].name}！跟它们拼了！`;
            });

            if (luckySurvivors.length > 0) {
                mapDataService.getLocationInfo(clickPos).then(info => {
                  generateRadioChatter(stateRef.current, clickPos, 'RESCUE', info || undefined).then(text => {
                    addLog({ sender: '运输机', text: `${text} (${luckySurvivors.length} 名平民获救于 ${info?.name || '目标区'})` });
                  });
                });
            } else {
                addLog({ sender: '系统', text: `投放位置无幸存者接收。` });
            }
        }

    } else if (selectedTool === ToolType.SPEC_OPS) {
        if (useResource(GAME_CONSTANTS.COST_SPEC_OPS) && checkCooldown(ToolType.SPEC_OPS, GAME_CONSTANTS.COOLDOWN_SPECOPS)) {
            audioService.playSound(SoundType.DEPLOY_ACTION);
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
                 age: 20 + Math.floor(Math.random() * 10),
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
        }
    } else if (selectedTool === ToolType.MEDIC_TEAM) {
        if (useResource(GAME_CONSTANTS.COST_MEDIC) && checkCooldown(ToolType.MEDIC_TEAM, GAME_CONSTANTS.COOLDOWN_MEDIC)) {
            audioService.playSound(SoundType.DEPLOY_ACTION);
            for(let i=0; i<2; i++) { // Deploy 2 medics
               entitiesRef.current.push({
                 id: `medic-${Date.now()}-${i}`,
                 type: EntityType.SOLDIER, // Uses soldier movement stats
                 name: getRandomName(true),
                 age: 30 + Math.floor(Math.random() * 10),
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
      className="h-full w-full z-0 bg-gray-900 cursor-crosshair"
    >
      <TileLayer
        attribution='&copy; OSM'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles"
      />
      <MapEvents onMapClick={handleMapClick} onDrag={onCancelFollow} />
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
};

export default GameMap;
