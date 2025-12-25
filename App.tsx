
import React, { useState, useCallback, useEffect } from 'react';
import GameMap from './components/GameMap';
import UIOverlay from './components/UIOverlay';
import { GameState, RadioMessage, ToolType } from './types';
import { GAME_CONSTANTS } from './constants';
import { audioService } from './services/audioService';

const App: React.FC = () => {
  const [gameId, setGameId] = useState(0); 
  
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: true,
    isPaused: false,
    healthyCount: GAME_CONSTANTS.INITIAL_POPULATION,
    infectedCount: 2,
    soldierCount: 0,
    gameResult: null,
    resources: GAME_CONSTANTS.INITIAL_RESOURCES,
    selectedEntity: null,
    cooldowns: {}
  });

  const [radioLogs, setRadioLogs] = useState<RadioMessage[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.NONE);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [followingEntityId, setFollowingEntityId] = useState<string | null>(null);

  useEffect(() => {
    const initAudio = () => {
        audioService.init();
        window.removeEventListener('click', initAudio);
        window.removeEventListener('keydown', initAudio);
    };
    window.addEventListener('click', initAudio);
    window.addEventListener('keydown', initAudio);
    return () => {
        window.removeEventListener('click', initAudio);
        window.removeEventListener('keydown', initAudio);
    };
  }, []);

  const handleStateUpdate = useCallback((newState: GameState) => {
    setGameState(prev => ({
        ...prev,
        healthyCount: newState.healthyCount,
        infectedCount: newState.infectedCount,
        soldierCount: newState.soldierCount,
        gameResult: newState.gameResult,
        resources: newState.resources,
        selectedEntity: newState.selectedEntity,
        cooldowns: newState.cooldowns
    }));
  }, []);

  const handleAddLog = useCallback((msg: RadioMessage) => {
    setRadioLogs(prev => [...prev.slice(-49), msg]);
  }, []);

  const togglePause = () => {
    setGameState(prev => {
      if (prev.isPaused) audioService.startBGM();
      else audioService.stopBGM(); 
      return { ...prev, isPaused: !prev.isPaused };
    });
  };

  const handleResetGame = () => {
    setGameId(prev => prev + 1);
    setGameState({
      isPlaying: true,
      isPaused: false,
      healthyCount: GAME_CONSTANTS.INITIAL_POPULATION,
      infectedCount: 2,
      soldierCount: 0,
      gameResult: null,
      resources: GAME_CONSTANTS.INITIAL_RESOURCES,
      selectedEntity: null,
      cooldowns: {}
    });
    setRadioLogs([]);
    setSelectedTool(ToolType.NONE);
    setSelectedEntityId(null);
    audioService.stopBGM();
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <GameMap 
        key={gameId} 
        selectedTool={selectedTool}
        isPaused={gameState.isPaused}
        initialState={gameState}
        onUpdateState={handleStateUpdate}
        onAddLog={handleAddLog}
        selectedEntityId={selectedEntityId}
        onEntitySelect={setSelectedEntityId}
        followingEntityId={followingEntityId}
        onCancelFollow={() => setFollowingEntityId(null)}
      />
      
      <UIOverlay 
        gameState={gameState}
        radioLogs={radioLogs}
        selectedTool={selectedTool}
        onSelectTool={setSelectedTool}
        onTogglePause={togglePause}
        onReset={handleResetGame}
        onLocateEntity={(id) => { 
            setFollowingEntityId(id); 
            setSelectedEntityId(id); 
        }}
      />
    </div>
  );
};

export default App;
