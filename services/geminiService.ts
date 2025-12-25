
import { GoogleGenAI } from "@google/genai";
import { GameState, Coordinates } from '../types';

let ai: GoogleGenAI | null = null;

if (process.env.API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
}

export const generateRadioChatter = async (
  gameState: GameState, 
  location: Coordinates,
  event: 'START' | 'RESCUE' | 'WAVE_CLEARED' | 'LOW_HEALTH' | 'RANDOM' | 'DISCOVERY',
  locationInfo?: any // LocationInfo type from mapDataService
): Promise<string> => {
  if (!ai) return "指挥中心连接中断...";

  const { healthyCount, infectedCount, soldierCount } = gameState;
  const loc = locationInfo || { name: '未知区域' };
  
  const envDetail = [
    loc.road ? `街道: ${loc.road}` : null,
    loc.feature ? `地标/建筑: ${loc.feature}` : null,
    loc.suburb ? `区域: ${loc.suburb}` : null,
    loc.type ? `环境类型: ${loc.type}` : null
  ].filter(Boolean).join(', ');

  const systemPrompt = `你是一个写实风格丧尸爆发模拟游戏的文案生成器。
  当前环境信息: ${loc.name}. ${envDetail ? `详细上下文: ${envDetail}` : ''}.
  生存者: ${healthyCount}, 感染者: ${infectedCount}, 作战部队: ${soldierCount}.
  规则: 
  1. 必须根据提供的地理位置、街道或建筑名称构建对话。
  2. 语气要逼真且具有沉浸感（紧张、绝望或冷酷的军事风）。
  3. 严禁使用通用模板。必须提及具体的环境细节（如“在${loc.road || '这条街'}拐角”、“靠近${loc.feature || '建筑'}”）。
  4. 只有1句话，简洁有力。`;

  const eventPrompts = {
    START: "作为指挥官宣布疫情爆发。",
    RESCUE: "作为飞行员或部队负责人确认抵达目标区。",
    WAVE_CLEARED: "作为高层宣布区域暂时肃清。",
    LOW_HEALTH: "作为情报员警告感染失控。",
    RANDOM: "作为前线士兵或幸存者进行随机无线电报告，必须描述当前看到的街道环境和僵尸活动。",
    DISCOVERY: "作为情报员，报告在该地标或街道首次发现感染者，语气急迫。"
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n任务: ${eventPrompts[event]}` }] }]
    });
    return response.text?.trim() || "信号干扰...";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "通讯链路不稳定";
  }
};
