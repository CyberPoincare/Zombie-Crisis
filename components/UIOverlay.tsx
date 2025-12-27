import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GameState, RadioMessage, ToolType, EntityType, WeaponType, SoundType, Building } from '../types';
import { GAME_CONSTANTS, WEAPON_STATS } from '../constants';
import { audioService } from '../services/audioService';

interface UIOverlayProps {
  gameState: GameState;
  radioLogs: RadioMessage[];
  selectedTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  onTogglePause: () => void;
  onReset: () => void;
  onLocateEntity: (id: string) => void;
  followingEntityId: string | null;
  onToggleFollow: (id: string) => void;
  onAnalyzeBuilding?: (id: string) => void;
  onScavengeBuilding?: (id: string) => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ gameState, radioLogs, selectedTool, onSelectTool, onTogglePause, onReset, onLocateEntity, followingEntityId, onToggleFollow, onAnalyzeBuilding, onScavengeBuilding }) => {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [size, setSize] = useState({ width: 384, height: 224 });
  const [resizeDir, setResizeDir] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    // Set initial size based on screen width
    if (window.innerWidth < 1024) {
        setSize({ width: Math.min(window.innerWidth - 32, 340), height: 160 });
    }
  }, []);

  const handleScroll = () => {
    if (scrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 20;
    }
  };

  const lastLogsCountRef = useRef(radioLogs.length);

  useEffect(() => {
    if (scrollRef.current) {
        const el = scrollRef.current;
        const newCount = radioLogs.length;
        const oldCount = lastLogsCountRef.current;
        
        if (isAtBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        } else if (newCount >= 200 && oldCount >= 200) {
            // We likely removed an item from the top and added one at the bottom
            // This causes a jump. We need to compensate.
            // Assuming most log lines are roughly the same height, but to be precise, 
            // we could capture the height of the first child before it's removed.
            // For now, let's just avoid auto-scroll if not at bottom.
            // Browsers usually handle "scroll anchoring" automatically now, 
            // but if not, we'd need to adjust scrollTop here.
        }
        lastLogsCountRef.current = newCount;
    }
  }, [radioLogs]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (!resizeDir) return;
        
        setSize(prev => {
            let newWidth = prev.width;
            let newHeight = prev.height;
            
            if (resizeDir.includes('right')) {
                // Since it's bottom-left anchored, dragging right increases width
                newWidth = Math.max(250, e.clientX - 16); 
            }
            if (resizeDir.includes('top')) {
                // Since it's bottom-left anchored, dragging up (smaller Y) increases height
                const bottomY = window.innerHeight - 16;
                newHeight = Math.max(150, bottomY - e.clientY);
            }
            
            return { width: newWidth, height: newHeight };
        });
    };

    const handleMouseUp = () => setResizeDir(null);

    if (resizeDir) {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeDir]);

  useEffect(() => {
      const interval = setInterval(() => setTick(t => t + 1), 100);
      return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (selectedTool !== ToolType.NONE) {
                audioService.playSound(SoundType.UI_CLICK);
                onSelectTool(ToolType.NONE);
                // Blur the active element to remove persistent focus ring
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTool, onSelectTool]);

  const totalPop = gameState.healthyCount + gameState.infectedCount + gameState.soldierCount;
  const pctHealthy = totalPop > 0 ? (gameState.healthyCount / totalPop) * 100 : 0;
  const pctSoldier = totalPop > 0 ? (gameState.soldierCount / totalPop) * 100 : 0;
  const pctInfected = totalPop > 0 ? (gameState.infectedCount / totalPop) * 100 : 0;

  const getWeaponInfo = (entity: any) => {
      if (!entity.isArmed) return null;
      const wType = entity.weaponType || WeaponType.PISTOL;
      return WEAPON_STATS[wType];
  };

  const getTacticalAnalysis = (building: Building) => {
      const type = building.type.toLowerCase();
      if (type.includes('apartments') || type.includes('residential') || type.includes('house')) {
          return {
              title: t('building_types.residential'),
              description: t('building_analysis.residential_desc'),
              pros: [t('building_analysis.pros.cover'), t('building_analysis.pros.resources')],
              cons: [t('building_analysis.cons.narrow'), t('building_analysis.cons.isolation')],
              safety: "MEDIUM"
          };
      }
      if (type.includes('office') || type.includes('commercial') || type.includes('retail') || type.includes('mall')) {
          return {
              title: t('building_types.commercial'),
              description: t('building_analysis.commercial_desc'),
              pros: [t('building_analysis.pros.view'), t('building_analysis.pros.space')],
              cons: [t('building_analysis.cons.weak_def'), t('building_analysis.cons.lighting')],
              safety: "LOW"
          };
      }
      if (type.includes('hospital') || type.includes('university') || type.includes('school')) {
          return {
              title: t('building_types.public'),
              description: t('building_analysis.public_desc'),
              pros: [t('building_analysis.pros.high_value'), t('building_analysis.pros.solid')],
              cons: [t('building_analysis.cons.zombie_hotspot'), t('building_analysis.cons.complex')],
              safety: "HIGH"
          };
      }
      if (type.includes('industrial') || type.includes('factory') || type.includes('warehouse')) {
          return {
              title: t('building_types.industrial'),
              description: t('building_analysis.industrial_desc'),
              pros: [t('building_analysis.pros.absolute_cover'), t('building_analysis.pros.privacy')],
              cons: [t('building_analysis.cons.echo'), t('building_analysis.cons.blind_spots')],
              safety: "VERY HIGH"
          };
      }
      return {
          title: t('building_types.general'),
          description: t('building_analysis.general_desc'),
          pros: [t('building_analysis.pros.general_cover')],
          cons: [t('building_analysis.cons.no_advantage')],
          safety: "LOW"
      };
  };

  const renderBuildingInspector = () => {
    if (!gameState.selectedBuilding) return null;
    const b = gameState.selectedBuilding;
    const analysis = getTacticalAnalysis(b);

    const now = Date.now();
    const cooldownEnd = b.analysis?.cooldownEnd || 0;
    const remaining = Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
    const onCooldown = remaining > 0;
    const isAnalyzing = b.analysis?.isAnalyzing || false;

    return (
      <div className="absolute top-28 right-4 w-72 bg-slate-900/95 backdrop-blur-xl border border-yellow-500/30 rounded-xl p-4 shadow-[0_0_30px_rgba(234,179,8,0.15)] z-30 pointer-events-auto transition-all duration-300 animate-fade-in border-t-yellow-500/60 border-t-2">
          <div className="flex items-center justify-between border-b border-slate-700/50 pb-2 mb-4">
              <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                  <h3 className="text-[10px] font-black text-yellow-500 tracking-[0.2em] uppercase">{t('building_inspector')}</h3>
              </div>
              <span className="text-[9px] font-mono text-slate-500">ID: {b.id.split('-')[1]}</span>
          </div>

          <div className="space-y-4">
              <div>
                  <h4 className="text-xl font-black text-white leading-tight">{b.name}</h4>
                  <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">{b.type.toUpperCase()}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        analysis.safety === 'VERY HIGH' ? 'text-emerald-400 bg-emerald-400/10' :
                        analysis.safety === 'HIGH' ? 'text-blue-400 bg-blue-400/10' :
                        analysis.safety === 'MEDIUM' ? 'text-yellow-400 bg-yellow-400/10' :
                        'text-red-400 bg-red-400/10'
                      }`}>
                          {t('safety_estimate')}: {analysis.safety}
                      </span>
                  </div>
              </div>

              <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 space-y-2">
                  <h5 className="text-[10px] font-bold text-yellow-500/80 uppercase tracking-wider">{analysis.title}</h5>
                  <p className="text-xs text-slate-400 leading-relaxed italic">
                      "{analysis.description}"
                  </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                      <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter">{t('tactical_pros')}</div>
                      <div className="space-y-1">
                          {analysis.pros.map((p, i) => (
                              <div key={i} className="text-[10px] text-slate-300 flex items-center gap-1.5 line-clamp-1">
                                  <span className="w-1 h-1 bg-emerald-500 rounded-full"></span> {p}
                              </div>
                          ))}
                      </div>
                  </div>
                  <div className="space-y-1.5">
                      <div className="text-[9px] font-bold text-red-400 uppercase tracking-tighter">{t('tactical_cons')}</div>
                      <div className="space-y-1">
                          {analysis.cons.map((c, i) => (
                              <div key={i} className="text-[10px] text-slate-300 flex items-center gap-1.5 line-clamp-1">
                                  <span className="w-1 h-1 bg-red-400 rounded-full"></span> {c}
                              </div>
                          ))}
                      </div>
                  </div>
              </div>

              {/* Tactical Analysis Section */}
              <div className="pt-2 border-t border-slate-700/50 space-y-3">
                  <button 
                    onClick={() => { audioService.playSound(SoundType.UI_CLICK); onAnalyzeBuilding?.(b.id); }}
                    disabled={onCooldown || isAnalyzing}
                    className={`w-full py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 border ${
                        (onCooldown || isAnalyzing)
                        ? 'bg-slate-800/50 border-slate-700 text-slate-500 cursor-not-allowed' 
                        : 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/20 active:scale-95 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                    }`}
                  >
                      {isAnalyzing ? t('scanning') : (onCooldown ? t('cooldown', { s: remaining }) : t('start_tactical'))}
                  </button>

                  {b.analysis && (
                      <div className="space-y-3 animate-fade-in">
                          {/* Scavenge Button */}
                          <div className="pt-2 border-t border-slate-700/50">
                              {(() => {
                                  const sCooldownEnd = b.analysis.scavengeCooldownEnd || 0;
                                  const sRemaining = Math.max(0, Math.ceil((sCooldownEnd - now) / 1000));
                                  const sOnCooldown = sRemaining > 0;
                                  
                                  return (
                                      <button 
                                          onClick={() => { audioService.playSound(SoundType.UI_CLICK); onScavengeBuilding?.(b.id); }}
                                          disabled={sOnCooldown || isAnalyzing}
                                          className={`w-full py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 border ${
                                              (sOnCooldown || isAnalyzing)
                                              ? 'bg-slate-800/50 border-slate-700 text-slate-500 cursor-not-allowed' 
                                              : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                                          }`}
                                      >
                                          {sOnCooldown ? t('scavenging', { s: sRemaining }) : t('scavenge_resources')}
                                      </button>
                                  );
                              })()}
                          </div>

                           <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg space-y-2">
                              <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{t('survival_guide')}</span>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                                  {b.analysis.survivalGuide}
                              </p>
                          </div>

                          <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg space-y-2">
                               <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">{t('tactical_report')}</span>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-relaxed font-medium italic">
                                  {b.analysis.tacticalReport}
                              </p>
                              <div className="flex justify-between items-center pt-1 border-t border-slate-700/50">
                                  <span className="text-[9px] font-mono text-slate-400">{t('area_detection')}:</span>
                                  <div className="flex gap-2 text-[9px] font-mono">
                                      <span className="text-red-400">Z:{b.analysis.nearbyStats.zombies}</span>
                                      <span className="text-blue-400">S:{b.analysis.nearbyStats.soldiers}</span>
                                      <span className="text-emerald-400">C:{b.analysis.nearbyStats.civilians}</span>
                                  </div>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>
    );
  };

  const renderInspector = () => {
      if (!gameState.selectedEntity) return null;
      const ent = gameState.selectedEntity;
      
      if (ent.isDead) {
          return (
            <div className="absolute top-28 right-4 w-64 bg-slate-900/95 backdrop-blur-xl border border-slate-600 rounded-xl p-4 shadow-2xl z-30 pointer-events-auto grayscale">
                <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-3">
                    <h3 className="text-sm font-bold text-slate-400 tracking-wider uppercase">{t('deceased')}</h3>
                    <div className="w-3 h-3 bg-slate-600 rounded-sm rotate-45"></div>
                </div>
                <div className="space-y-2 opacity-70">
                    <div className="flex justify-between items-end">
                        <span className="text-2xl font-black text-slate-300 line-through">{ent.name}</span>
                        <span className="text-xs text-slate-500 mb-1">{t(ent.isMale ? 'gender_m' : 'gender_f')} / {ent.age}{t('age_suffix')}</span>
                    </div>
                    <div className="text-xs text-slate-500 italic">{t('corpse')}</div>
                </div>
            </div>
          );
      }

      return (
        <div className="absolute top-28 right-4 w-64 bg-slate-900/95 backdrop-blur-xl border border-slate-500/50 rounded-xl p-4 shadow-2xl z-30 pointer-events-auto transition-all duration-200 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white tracking-wider uppercase">{t('entity_inspector')}</h3>
                    <div className={`w-3 h-3 rounded-full animate-pulse ${ent.type === EntityType.ZOMBIE ? 'bg-red-500' : ent.type === EntityType.SOLDIER ? 'bg-blue-500' : 'bg-emerald-500'}`}></div>
                </div>
                <button 
                  onClick={() => { audioService.playSound(SoundType.UI_CLICK); onToggleFollow(ent.id); }}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold transition-all border ${
                    followingEntityId === ent.id 
                    ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]' 
                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                  title={followingEntityId === ent.id ? t('following') : t('follow')}
                >
                  {followingEntityId === ent.id ? t('following') : t('follow')}
                </button>
            </div>
            
            <div className="space-y-2">
                <div className="flex justify-between items-end">
                    <span className="text-2xl font-black text-white">{ent.name}</span>
                    <span className="text-xs text-slate-400 mb-1">{t(ent.isMale ? 'gender_m' : 'gender_f')} / {ent.age}{t('age_suffix')}</span>
                </div>
                
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                        {ent.type === EntityType.ZOMBIE ? t('type_zombie') : ent.type === EntityType.SOLDIER ? t('type_soldier') : t('type_civilian')}
                    </span>
                    {ent.isMedic && <span className="text-[10px] font-bold bg-white text-red-600 px-2 py-0.5 rounded">{t('medic')}</span>}
                    {ent.isTrapped && <span className="text-[10px] font-bold bg-cyan-500 text-black px-2 py-0.5 rounded animate-pulse">{t('trapped', { s: (ent.trappedTimer/1000).toFixed(1) })}</span>}
                </div>

                {ent.isArmed && getWeaponInfo(ent) && (
                    <div className="bg-slate-800/50 border border-slate-700 p-2 rounded flex items-center justify-between mt-1">
                        <div className="flex flex-col">
                             <span className="text-[10px] text-yellow-400 font-bold uppercase">{getWeaponInfo(ent).name}</span>
                             <span className="text-[8px] text-slate-400">{getWeaponInfo(ent).description}</span>
                        </div>
                        <div className="w-2 h-2 rounded-full" style={{backgroundColor: getWeaponInfo(ent).color}}></div>
                    </div>
                )}

                {/* Health Bar */}
                <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                        <span>{t('health')}</span>
                        <span>{Math.max(0, Math.floor(ent.health))}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${ent.health < 5 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{width: `${Math.min(100, Math.max(0, ent.health * 5))}%`}}></div>
                    </div>
                </div>

                {/* Thoughts Bubble */}
                <div className="mt-4 relative bg-slate-800 p-3 rounded-lg rounded-tl-none border border-slate-700">
                    <div className="absolute -top-2 left-0 w-0 h-0 border-l-[10px] border-l-slate-800 border-t-[10px] border-t-transparent transform rotate-90"></div>
                    <p className="text-xs italic text-slate-300 leading-relaxed">
                        "{ent.thought}"
                    </p>
                </div>
            </div>
        </div>
      );
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden font-sans">
      
      {/* Top Bar: Simulation Stats */}
      <div className="absolute top-0 left-0 right-0 bg-slate-900/90 backdrop-blur-md p-3 md:p-4 flex flex-col gap-2 md:gap-3 pointer-events-auto border-b border-slate-700 shadow-2xl z-20">
        <div className="flex justify-between items-center gap-2">
             <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
                <h1 className="text-lg md:text-2xl font-black text-white tracking-tight md:tracking-widest italic drop-shadow-md whitespace-nowrap">
                 {t('title')} <span className="text-red-500">{t('op_code_z')}</span>
                </h1>
                <button 
                    onClick={() => { audioService.playSound(SoundType.UI_CLICK); onTogglePause(); }}
                    className={`
                        min-w-[100px] md:min-w-[120px] h-7 md:h-8 px-2 md:px-4 rounded font-bold text-[10px] md:text-xs uppercase tracking-wider border transition-all flex items-center justify-center whitespace-nowrap
                        ${gameState.isPaused 
                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500 animate-pulse' 
                            : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                        }
                    `}
                >
                     {gameState.isPaused ? `⏸ ${t('paused')}` : `▶ ${t('running')}`}
                </button>
             </div>
             <div className="flex items-center gap-2 md:gap-3 bg-slate-800 px-2 md:px-4 py-1 md:py-1.5 rounded-lg border border-slate-600 shadow-inner shrink-0">
                <a 
                    href="https://github.com/CyberPoincare/Zombie-Crisis" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center text-slate-400 hover:text-white transition-colors duration-200"
                    onClick={() => audioService.playSound(SoundType.UI_CLICK)}
                    title="GitHub Open Source"
                >
                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                </a>
                <div className="w-px h-4 bg-slate-600 mx-1 hidden xs:block"></div>
                 <span className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-wider hidden xs:inline">{t('budget')}</span>
                <span className={`${gameState.resources < 50 ? 'text-red-500 animate-pulse' : 'text-yellow-400'} font-mono font-bold text-base md:text-xl`}>${Math.floor(gameState.resources)}</span>
             </div>
        </div>

        {/* Population Bar */}
        <div className="flex flex-col gap-1">
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex relative shadow-inner border border-slate-700/50">
                <div className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-500" style={{width: `${pctHealthy}%`}} />
                <div className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-500" style={{width: `${pctSoldier}%`}} />
                <div className="h-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)] transition-all duration-500" style={{width: `${pctInfected}%`}} />
            </div>
            <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase">
                 <span className="text-emerald-400 drop-shadow-sm">{t('survivors')}: {gameState.healthyCount}</span>
                 <span className="text-blue-400 drop-shadow-sm">{t('soldiers')}: {gameState.soldierCount}</span>
                 <span className="text-red-500 drop-shadow-sm">{t('infected')}: {gameState.infectedCount}</span>
            </div>
        </div>
      </div>

      {/* Entity Inspector */}
      {renderInspector()}
      
      {/* Building Inspector */}
      {renderBuildingInspector()}

      {/* Middle: Victory/Defeat Modal */}
      {gameState.gameResult && (
         <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-50 animate-fade-in">
            <div className={`border-4 p-8 rounded-2xl text-center max-w-md shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-slate-800 ${gameState.gameResult === 'VICTORY' ? 'border-emerald-500 shadow-emerald-900/20' : 'border-red-600 shadow-red-900/20'}`}>
                <h2 className={`text-6xl font-black mb-2 tracking-tighter ${gameState.gameResult === 'VICTORY' ? 'text-emerald-500' : 'text-red-600'}`}>
                     {gameState.gameResult === 'VICTORY' ? t('victory') : t('defeat')}
                </h2>
                <div className="h-1 w-24 mx-auto bg-slate-600 mb-6 rounded-full"></div>
                <p className="text-slate-300 mb-8 text-lg font-medium leading-relaxed">
                    {gameState.gameResult === 'VICTORY'                         ? t('victory_msg') 
                         : t('defeat_msg')}
                </p>
                <button 
                  onClick={() => { audioService.playSound(SoundType.UI_CLICK); onReset(); }}
                  className="bg-white hover:bg-slate-200 text-slate-900 font-black py-4 px-10 rounded-xl transition-all transform hover:scale-105 uppercase tracking-widest shadow-lg"
                >
                     {t('redeploy')}
                </button>
            </div>
         </div>
      )}

      {/* Bottom Left: Radio Log */}
      <div className="absolute bottom-[calc(7rem+env(safe-area-inset-bottom))] lg:bottom-4 left-4 z-20 pointer-events-auto flex">
          <div 
            style={{ width: `${size.width}px`, height: `${size.height}px` }}
            className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 p-3 md:p-4 rounded-xl overflow-hidden flex flex-col shadow-2xl relative group/window"
          >
              {/* Resize Handles */}
              <div 
                className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-30 flex items-center justify-center opacity-0 group-hover/window:opacity-100 transition-opacity"
                onMouseDown={(e) => { e.preventDefault(); setResizeDir('top-right'); }}
              >
                  <div className="w-1.5 h-1.5 bg-slate-500 rounded-full"></div>
              </div>
              <div 
                className="absolute top-0 left-0 right-0 h-1 cursor-n-resize z-30"
                onMouseDown={(e) => { e.preventDefault(); setResizeDir('top'); }}
              ></div>
              <div 
                className="absolute top-0 right-0 bottom-0 w-1 cursor-e-resize z-30"
                onMouseDown={(e) => { e.preventDefault(); setResizeDir('right'); }}
              ></div>

              <h3 className="text-[10px] font-bold text-emerald-500 uppercase mb-3 tracking-widest flex items-center gap-2 border-b border-slate-700 pb-2 shrink-0">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]"></span>
                   {t('radio_channel')}
              </h3>
              <div ref={scrollRef} onScroll={handleScroll} className="overflow-y-auto flex-1 space-y-3 pr-2 text-xs font-mono leading-relaxed">
                   {radioLogs.length === 0 && <span className="text-slate-600 italic">{t('establishing_link')}</span>}
                  {radioLogs.map(log => (
                      <div key={log.id} className="flex gap-2 animate-fade-in">
                          <span className="text-slate-500 shrink-0">[{new Date(log.timestamp).toLocaleTimeString([], {hour12: false, hour:'2-digit', minute:'2-digit'})}]</span> 
                          <div>
                              <span 
                                className={`font-bold mr-2 transition-all ${log.senderId ? 'cursor-pointer hover:underline hover:brightness-125' : ''} ${log.sender === t('headquarters') ? 'text-yellow-500' : log.sender === t('system') ? 'text-red-400' : 'text-blue-400'}`}
                                onClick={() => log.senderId && onLocateEntity(log.senderId)}
                              >
                                  {log.sender}:
                              </span>
                              <span className="text-slate-300">{log.text}</span>
                          </div>
                      </div>
                  ))}
              </div>
              
              {!isAtBottomRef.current && radioLogs.length > 0 && (
                  <button 
                    onClick={() => {
                        if (scrollRef.current) {
                            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                            isAtBottomRef.current = true;
                            setTick(t => t + 1); // trigger re-render to hide button
                        }
                    }}
                    className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white text-[10px] px-3 py-1 rounded-full shadow-lg border border-blue-400 animate-bounce transition-all hover:bg-blue-500"
                  >
                       ⬇ {t('new_messages')}
                  </button>
              )}
          </div>
      </div>

      {/* Bottom Right: Toolbar */}
      <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 left-4 lg:left-auto z-20 pointer-events-auto overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-3 justify-center lg:justify-end min-w-max px-4 py-2">
            <ToolButton 
                icon="🖐️" 
                 line1={t('observe')}
                 line2={t('move')}
                cost={0} 
                cooldownEnd={0}
                isActive={selectedTool === ToolType.NONE} 
                onClick={() => { audioService.playSound(SoundType.UI_CLICK); onSelectTool(ToolType.NONE); }} 
            />
            <ToolButton 
                icon="📦" 
                 line1={t('air_drop_1')}
                 line2={t('air_drop_2')}
                cost={GAME_CONSTANTS.COST_SUPPLY} 
                cooldownEnd={gameState.cooldowns[ToolType.SUPPLY_DROP] || 0}
                isActive={selectedTool === ToolType.SUPPLY_DROP} 
                onClick={() => { audioService.playSound(SoundType.UI_CLICK); onSelectTool(ToolType.SUPPLY_DROP); }} 
            />
            <ToolButton 
                icon="🚁" 
                 line1={t('spec_ops_1')} 
                 line2={t('spec_ops_2')}
                cost={GAME_CONSTANTS.COST_SPEC_OPS} 
                cooldownEnd={gameState.cooldowns[ToolType.SPEC_OPS] || 0}
                isActive={selectedTool === ToolType.SPEC_OPS} 
                onClick={() => { audioService.playSound(SoundType.UI_CLICK); onSelectTool(ToolType.SPEC_OPS); }} 
            />
            <ToolButton 
                icon="💉" 
                 line1={t('medic_1')} 
                 line2={t('medic_2')}
                cost={GAME_CONSTANTS.COST_MEDIC} 
                cooldownEnd={gameState.cooldowns[ToolType.MEDIC_TEAM] || 0}
                isActive={selectedTool === ToolType.MEDIC_TEAM} 
                onClick={() => { audioService.playSound(SoundType.UI_CLICK); onSelectTool(ToolType.MEDIC_TEAM); }} 
            />
            <ToolButton 
                icon="✈️" 
                 line1={t('airstrike_1')}
                 line2={t('airstrike_2')}
                cost={GAME_CONSTANTS.COST_AIRSTRIKE} 
                cooldownEnd={gameState.cooldowns[ToolType.AIRSTRIKE] || 0}
                isActive={selectedTool === ToolType.AIRSTRIKE} 
                onClick={() => { audioService.playSound(SoundType.UI_CLICK); onSelectTool(ToolType.AIRSTRIKE); }} 
            />
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
    icon: string, 
    line1: string, 
    line2: string,
    cost: number, 
    cooldownEnd: number,
    isActive: boolean, 
    onClick: () => void
}> = ({icon, line1, line2, cost, cooldownEnd, isActive, onClick}) => {
    
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
    const onCooldown = remaining > 0;

    return (
        <button 
            onClick={onClick}
            disabled={onCooldown}
            className={`
                group relative flex flex-col items-center justify-center 
                w-16 h-16 xs:w-20 xs:h-20 sm:w-32 sm:h-32 rounded-xl sm:rounded-2xl transition-all duration-200 
                border shadow-xl shrink-0 overflow-hidden focus:outline-none
                ${isActive 
                    ? 'bg-slate-800 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)] scale-105 z-10' 
                    : 'bg-slate-800/80 border-slate-600 hover:bg-slate-700 hover:border-slate-500 hover:-translate-y-1'
                }
                ${onCooldown ? 'opacity-70 cursor-not-allowed' : ''}
            `}
        >
            {/* Cost Badge */}
            {cost > 0 && !onCooldown && (
                <div className={`
                    absolute top-1 right-1 sm:top-2 sm:right-2 
                    px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-mono font-bold tracking-tight z-10
                    ${isActive ? 'bg-blue-500 text-white' : 'bg-slate-800/90 text-yellow-400 border border-slate-700/50'}
                `}>
                    ${cost}
                </div>
            )}

            {/* Cooldown Overlay */}
            {onCooldown && (
                <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-20 backdrop-blur-[1px]">
                    <span className="text-2xl font-black text-white font-mono animate-pulse">{remaining}s</span>
                </div>
            )}

            <div className="text-lg xs:text-xl sm:text-5xl mb-1 sm:mb-2 filter drop-shadow-lg transform group-hover:scale-110 transition-transform duration-300">
                {icon}
            </div>
            
            <div className="flex flex-col items-center leading-none">
                <span className={`text-[8px] xs:text-[9px] sm:text-xs font-black tracking-widest uppercase ${isActive ? 'text-white' : 'text-slate-300'}`}>
                    {line1}
                </span>
                <span className={`text-[8px] xs:text-[9px] sm:text-xs font-black tracking-widest uppercase mt-0.5 ${isActive ? 'text-white' : 'text-slate-300'}`}>
                    {line2}
                </span>
            </div>

            {isActive && !onCooldown && (
                <div className="absolute inset-0 rounded-2xl ring-2 ring-blue-400 ring-inset animate-pulse pointer-events-none"></div>
            )}
        </button>
    );
};

export default UIOverlay;
