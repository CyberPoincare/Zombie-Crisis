<div align="center">
<img width="1200" alt="Zombie Crisis Banner" src="resources/banner.jpg" />
</div>

# Zombie Crisis: OSM Operations

## 项目简介
**Zombie Crisis** 是一款基于 OpenStreetMap (OSM) 的实时生存模拟管理游戏。玩家在真实的地理位置上指挥特种小队、部署空中补给和支援，保护平民免受僵尸病毒的侵害。游戏通过高度互动的地图界面和真实感十足的无线电通讯系统，为玩家提供紧张刺激的危机应对体验。

## 程序架构 (Architecture)

本项目采用现代的前端技术栈构建，专注于高性能的实时状态处理和交互渲染。

### 1. 核心技术栈

- **框架**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **地图引擎**: [Leaflet](https://leafletjs.com/) (配合 [React-Leaflet](https://react-leaflet.js.org/))
- **构建工具**: [Vite](https://vitejs.dev/)
- **样式**: CSS (Vanilla CSS + Tailwind-like logic)

### 2. 模块划分

- **`App.tsx`**: 应用根组件，管理顶级全局状态（资源、人口、暂停状态、镜头跟随等）。
- **`components/GameMap.tsx`**: 游戏逻辑核心。包含主循环 (Game Loop)、实体 AI (基于 Boids 避障与引导算法)、物理引擎模拟和地图事件处理.
- **`components/UIOverlay.tsx`**: HUD 界面层。处理实时通讯日志渲染、资源显示、交互面板和可缩放窗口。
- **`services/AudioService.ts`**: 统一的音效管理组件，负责各类交互和大气背景音的播放。
- **`constants.ts` & `types.ts`**: 核心配置参数与强类型定义，确保跨组件逻辑的一致性。

### 3. 系统特点

- **帧同步渲染**: 逻辑更新与地图渲染分离，确保在数百个实体同时活动时仍能保持流畅。
- **动态通讯系统**: 支持基于事件触发和随机权重生成的无线电语音逻辑。
- **交互驱动设计**: 地图交互（点击、拖拽）与 UI 状态（定位、跟随）深度联动。

## 运行与部署

### 本地开发 (Run Locally)

**必要条件 (Prerequisites):** 
- [Node.js](https://nodejs.org/) (推荐 v18+)
- **Google Gemini API Key**: 用于驱动游戏中的动态环境对话和 AI 无线电通讯。

**步骤:**

1. **安装依赖**:
   ```bash
   npm install
   ```

2. **配置环境变量**:
   在项目根目录下创建一个名为 `.env.local` 的文件，并将你的 Gemini API Key 填入：
   
   ```bash
   # .env.local 样例模板
   GEMINI_API_KEY=在这里替换成你的_API_KEY
   ```
   > [!TIP]
   > 你可以在 [Google AI Studio](https://aistudio.google.com/app/apikey) 免费获取 API Key。

3. **运行应用**:
   ```bash
   npm run dev
   ```

4. **访问**:
   打开浏览器访问 [http://localhost:3000](http://localhost:3000)

