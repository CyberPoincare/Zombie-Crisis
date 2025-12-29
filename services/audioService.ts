import i18n from '../i18n';
import { SoundType, WeaponType, BGMState } from '../types';

class AudioService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private lastSoundTime: number = 0;
  private lastAmbientTime: number = 0;

  // BGM System
  // BGM System
  private bgmBuffers: Map<BGMState, AudioBuffer> = new Map();
  private currentBGMNode: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private currentBGMState: BGMState = BGMState.NONE;
  private isLoadingBGM: boolean = false;

  // SFX System
  private sfxBuffers: Map<string, AudioBuffer[]> = new Map();
  private isLoadingSFX: boolean = false;

  constructor() {
  }

  public async init() {
    if (!this.ctx) {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    await Promise.all([
      this.loadAllBGM(),
      this.loadAllSFX()
    ]);
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return await this.ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn(`Failed to load buffer: ${url}`, e);
      return null;
    }
  }

  private async loadAllSFX() {
    if (!this.ctx || this.isLoadingSFX) return;
    this.isLoadingSFX = true;

    const sfxToLoad: { key: string; urls: string[] }[] = [
      { key: 'MALE_SCREAM', urls: Array.from({length: 8}, (_, i) => `/sounds/human/male/aargh${i}.ogg`) },
      { key: 'FEMALE_SCREAM', urls: ['/sounds/human/female/scream_1.ogg'] },
      { key: 'CHILD_SCREAM', urls: ['/sounds/human/child/scream_1.wav'] },
      { key: 'ZOMBIE', urls: Array.from({length: 24}, (_, i) => `/sounds/zombie/zombie-${i+1}.wav`) },
      { key: 'PISTOL', urls: ['/sounds/weapons/pistol_shot.wav'] },
      { key: 'SNIPER', urls: ['/sounds/weapons/sniper_shot.wav'] },
      { key: 'RIFLE', urls: ['/sounds/weapons/assault_rifle/Futuristic Assault Rifle Single Shot 01.wav'] },
      { key: 'BIG_GUN', urls: ['/sounds/weapons/bigguns/biggun1.wav'] },
    ];

    await Promise.all(sfxToLoad.map(async (group) => {
      const buffers = (await Promise.all(group.urls.map(url => this.loadBuffer(url))))
        .filter((b): b is AudioBuffer => b !== null);
      if (buffers.length > 0) {
        this.sfxBuffers.set(group.key, buffers);
      }
    }));

    this.isLoadingSFX = false;
  }

  private async loadAllBGM() {
    if (!this.ctx || this.isLoadingBGM || this.bgmBuffers.size > 0) return;
    this.isLoadingBGM = true;
    
    const tracks = [
      { state: BGMState.SAFE, url: '/audio/bgm_safe.mp3' },
      { state: BGMState.DANGER, url: '/audio/bgm_danger.mp3' },
      { state: BGMState.COMBAT, url: '/audio/bgm_combat.mp3' },
    ];

    try {
      await Promise.all(tracks.map(async (track) => {
        try {
            const response = await fetch(track.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
            this.bgmBuffers.set(track.state, audioBuffer);
        } catch (innerError) {
            console.error(`Failed to load BGM track ${track.state}:`, innerError);
        }
      }));
    } catch (e) {
      console.error("Failed to load BGM tracks", e);
    } finally {
      this.isLoadingBGM = false;
    }
  }

  // --- SYNTHESIS HELPERS ---

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * 2; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // --- SOUND EFFECTS ---

  public playSound(
    type: SoundType, 
    isPriority: boolean = false, 
    entityData?: { gender?: string; age?: number; isZombie?: boolean }
  ) {
    if (!this.ctx || this.isMuted) return;
    
    const now = this.ctx.currentTime;
    
    // 1. Weapon Throttle (Global)
    if (type.startsWith('WEAPON')) {
        if (!isPriority && now - this.lastSoundTime < 0.05) return;
        this.lastSoundTime = now;
    } 
    // 2. Ambient Throttle (Global)
    else if (type.startsWith('CIV') || type.startsWith('ZOM')) {
        if (!isPriority && now - this.lastAmbientTime < 0.5) return; // Max 2 per sec non-priority
        this.lastAmbientTime = now;
    }

    switch (type) {
      case SoundType.UI_CLICK:
        this.playTone(800, 'sine', 0.05, 0.1);
        break;
      case SoundType.AIRSTRIKE_TICK:
        this.playTone(1000, 'sine', 0.02, 0.4);
        this.playTone(2000, 'sine', 0.01, 0.3, 0.01);
        break;
      case SoundType.UI_SELECT:
        this.playTone(1200, 'sine', 0.05, 0.1);
        break;
      case SoundType.UI_ERROR:
        this.playTone(150, 'sawtooth', 0.2, 0.2);
        break;
      case SoundType.DEPLOY_ACTION:
        this.playTone(400, 'square', 0.1, 0.3);
        this.playTone(600, 'square', 0.1, 0.3, 0.1);
        break;
      case SoundType.WEAPON_PISTOL:
        if (this.playFromBuffer('PISTOL', isPriority ? 0.4 : 0.3)) return;
        this.playGunshot(0.08, 1200, isPriority ? 0.3 : 0.2);
        break;
      case SoundType.WEAPON_SHOTGUN:
        if (this.playFromBuffer('BIG_GUN', 0.5)) return;
        this.playGunshot(0.3, 500, 0.4);
        break;
      case SoundType.WEAPON_SNIPER:
        if (this.playFromBuffer('SNIPER', isPriority ? 0.7 : 0.5)) return;
        this.playGunshot(0.4, 3000, isPriority ? 0.6 : 0.4); 
        this.playTone(150, 'sawtooth', 0.1, 0.6, 0); 
        this.playTone(100, 'sine', 0.2, 0.8, 0); 
        break;
      case SoundType.WEAPON_ROCKET:
        this.playExplosion();
        break;
      case SoundType.WEAPON_NET:
        this.playTone(600, 'triangle', 0.05, 0.2);
        this.playTone(300, 'triangle', 0.1, 0.2, 0.05);
        break;
      case SoundType.HEAL_START:
        this.playTone(400, 'sine', 0.5, 0.1);
        break;
      case SoundType.HEAL_COMPLETE:
        this.playTone(800, 'sine', 0.1, 0.2);
        this.playTone(1200, 'sine', 0.2, 0.2, 0.1);
        break;
      case SoundType.CIV_ALARM:
        // Synthesis of a siren/alarm
        for (let i = 0; i < 4; i++) {
            const delay = i * 1.5;
            this.playTone(600, 'sawtooth', 0.8, 0.15, delay);
            this.playTone(400, 'sawtooth', 0.8, 0.15, delay + 0.8);
        }
        break;
      
      // Demographic-specific vocalizations
      case SoundType.CIV_FEAR:
      case SoundType.CIV_SCREAM:
      case SoundType.CIV_SHOUT:
      case SoundType.CIV_URGE:
      case SoundType.CIV_CRY:
      case SoundType.ZOM_ROAR:
      case SoundType.ZOM_BITE:
      case SoundType.ZOM_FIGHT:
        this.playVocalEffect(type, entityData || {});
        break;

      case SoundType.CIV_CLAP:
        this.playGunshot(0.04, 3000, 0.1); 
        break;
    }
  }

  private playVocalEffect(type: SoundType, data: { gender?: string; age?: number; isZombie?: boolean }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const isZombie = data.isZombie || type.startsWith('ZOM');
    const age = data.age || 30;
    const gender = data.gender;

    if (isZombie) {
        if (this.playFromBuffer('ZOMBIE', 0.25)) return;
    } else {
        let bufferKey = 'MALE_SCREAM';
        if (gender === i18n.t('gender_male')) bufferKey = 'MALE_SCREAM';
        else if (gender === i18n.t('gender_female')) bufferKey = 'FEMALE_SCREAM';

        if (this.playFromBuffer(bufferKey, 0.2)) return;
    }

    // Fallback to synthesis
    let baseFreq = 200; // Default male
    if (gender === i18n.t('gender_female')) baseFreq = 400;
    if (age < 12) baseFreq = 700; // Child
    if (age > 65) baseFreq = 140; // Elderly

    const vol = 0.15;
    
    if (isZombie) {
        // ZOMBIE VOCALS: Grittier, lower, erratic
        const duration = type === SoundType.ZOM_ROAR ? 0.8 : 0.2;
        const pitchDrift = 50;
        
        // Lower pitch for zombies
        baseFreq *= 0.6;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        
        osc.type = Math.random() < 0.3 ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.linearRampToValueAtTime(baseFreq - pitchDrift, now + duration);
        
        // Add "growl" modulation
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.setValueAtTime(20 + Math.random() * 20, now);
        lfoGain.gain.setValueAtTime(30, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(baseFreq * 2, now);
        
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(now + duration + 0.1);
        lfo.stop(now + duration + 0.1);
        
        // Add a bit of breath noise for roar
        if (type === SoundType.ZOM_ROAR) {
            this.playGunshot(duration, 300, 0.1);
        }
    } else {
        // HUMAN VOCALS: Cleaner but descriptive
        let duration = 0.2;
        let slide = 0;
        let wave: OscillatorType = 'sine';

        if (type === SoundType.CIV_SCREAM) {
            duration = 0.5;
            slide = 200;
            wave = 'sawtooth';
        } else if (type === SoundType.CIV_FEAR) {
            duration = 0.3;
            slide = -50;
            wave = 'sine';
        } else if (type === SoundType.CIV_SHOUT) {
            duration = 0.15;
            slide = 100;
            wave = 'square';
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = wave;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq + slide, now + duration);
        
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(now + duration + 0.1);
        
        // Add harmonics for high-stress screams
        if (type === SoundType.CIV_SCREAM) {
            const harmonic = this.ctx.createOscillator();
            harmonic.type = 'sine';
            harmonic.frequency.setValueAtTime(baseFreq * 1.5, now);
            harmonic.frequency.exponentialRampToValueAtTime(baseFreq * 1.5 + slide, now + duration);
            const hGain = this.ctx.createGain();
            hGain.gain.setValueAtTime(vol * 0.5, now);
            hGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
            harmonic.connect(hGain);
            hGain.connect(this.ctx.destination);
            harmonic.start();
            harmonic.stop(now + duration + 0.1);
        }
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, vol: number, delay: number = 0) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
    
    gain.gain.setValueAtTime(vol, this.ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + delay + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(this.ctx.currentTime + delay);
    osc.stop(this.ctx.currentTime + delay + duration + 0.1);
  }

  private playGunshot(duration: number, filterFreq: number, vol: number) {
    if (!this.ctx) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer();
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start();
    noise.stop(this.ctx.currentTime + duration);
  }

  private playFromBuffer(key: string, vol: number): boolean {
    if (!this.ctx) return false;
    const buffers = this.sfxBuffers.get(key);
    if (!buffers || buffers.length === 0) return false;

    const buffer = buffers[Math.floor(Math.random() * buffers.length)];
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
    return true;
  }

  private playExplosion() {
    if (!this.ctx) return;
    const duration = 1.5;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer();
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, this.ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(10, this.ctx.currentTime + duration); 

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start();
    noise.stop(this.ctx.currentTime + duration);
  }

  // --- BACKGROUND MUSIC SYSTEM ---
  
  public async setBGMState(newState: BGMState) {
    if (!this.ctx || this.isMuted || this.currentBGMState === newState) return;
    
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.bgmBuffers.size === 0 && !this.isLoadingBGM) await this.loadAllBGM();

    const nextBuffer = this.bgmBuffers.get(newState);
    if (!nextBuffer && newState !== BGMState.NONE) {
        console.warn(`BGM buffer for state ${newState} not found.`);
        return;
    }

    const fadeTime = 1.5;
    const now = this.ctx.currentTime;

    // Fade out old
    if (this.currentBGMNode) {
      const oldNode = this.currentBGMNode;
      oldNode.gain.gain.setValueAtTime(oldNode.gain.gain.value, now);
      oldNode.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
      setTimeout(() => {
        try {
          oldNode.source.stop();
          oldNode.source.disconnect();
          oldNode.gain.disconnect();
        } catch (e) {}
      }, fadeTime * 1000 + 100);
    }

    // Fade in new
    if (nextBuffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = nextBuffer;
      source.loop = true;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.4, now + fadeTime);

      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(now);

      this.currentBGMNode = { source, gain };
    } else {
      this.currentBGMNode = null;
    }

    this.currentBGMState = newState;
  }

  public startBGM() {
    if (this.currentBGMState === BGMState.NONE) {
        this.setBGMState(BGMState.SAFE);
    }
  }

  public stopBGM() {
    this.setBGMState(BGMState.NONE);
  }

  public toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
        this.stopBGM();
        if (this.ctx) this.ctx.suspend();
    } else {
        if (this.ctx) this.ctx.resume();
        this.startBGM();
    }
  }
}

export const audioService = new AudioService();
