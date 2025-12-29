<div align="center">
<img width="1200" alt="Zombie Crisis Banner" src="resources/banner.jpg" />

# Zombie Crisis: OSM Operations

**Real-world Survival Simulation Management Game**

[![Version](https://img.shields.io/badge/version-1.4.3-blue.svg)](package.json)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Repo-181717.svg)](https://github.com/CyberPoincare/Zombie-Crisis)

</div>

<p align="center">
  Language: <a href="README.md">简体中文</a> | <b>English</b>
</p>

---

## 🏗️ Project Introduction

**Zombie Crisis: OSM Operations** is a real-time survival simulation management game based on **OpenStreetMap (OSM)** data. Players act as war zone commanders, commanding special operations teams, deploying aerial supplies, implementing precision strikes, and protecting civilians from zombie virus infections on any real street in the world.

This project deeply integrates **Google Gemini 2.0 AI**, injecting dynamic tactical analysis and a highly immersive radio communication experience into the game.

---

## ✨ Core Features

- **🌍 Real-world Battlefield**:
  - Based on Leaflet and Overpass API, supporting battles at any location in the world.
  - Dynamically load real-world buildings, roads, and landmarks.
- **🤖 Gemini 2.0 Deep Integration**:
  - **Dynamic Communication**: AI generates real-time radio reports based on current real streets (e.g., "West Yulong Street") and landmarks.
  - **Tactical Scanning**: Deeply scan specific buildings to obtain AI-generated survival guides and battlefield situation reports.
- **🧠 Intelligent Entity Simulation**:
  - Supports hundreds of entities (zombies, civilians, soldiers) active simultaneously, based on Boids obstacle avoidance and steering algorithms.
  - Characters have independent mood systems, inner thought bubbles, and self-talk logic.
- **📡 Real-time Tactical HUD**:
  - **Resizable Communication Window**: Real-time monitoring of battlefield dynamics, supporting click-to-locate and teammate tracking.
  - **Building Inspector**: Automatically identifies building tactical attributes (defensive value, safety level).
- **🔊 Immersive Audio Control**:
  - Geospatial-aware audio system, dynamically adjusting sound priority based on battlefield focus.
  - Comprehensive sound library including weapons, civilian screams, infected roars, etc.

---

## 🛠️ Technical Architecture

The project uses modern front-end engineering solutions, focusing on real-time state processing efficiency:

- **Core Framework**: React 19 + TypeScript
- **Map Engine**: [Leaflet](https://leafletjs.com/) & [React-Leaflet](https://react-leaflet.js.org/)
- **AI Engine**: [Google Gemini 2.0 Flash](https://aistudio.google.com/)
- **Build/Deployment**: [Vite](https://vitejs.dev/) + ESP (Electronic Sandbox Platform) logic

---

## 🚀 Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- **Google Gemini API Key**: The core component driving AI radio and tactical analysis.

### 2. Get API Key

Visit [Google AI Studio](https://aistudio.google.com/app/apikey) to get your API Key for free.

### 3. Local Run

1.  **Clone and Install**:

    ```bash
    git clone https://github.com/CyberPoincare/Zombie-Crisis.git
    cd Zombie-Crisis
    npm install
    ```

2.  **Environment Variable Configuration**:
    Create a `.env.local` file in the root directory:

    ```bash
    GEMINI_API_KEY=your_API_KEY_here
    ```

3.  **Start Development Server**:

    ```bash
    npm run dev
    ```

    Default access address: `http://localhost:3000`

---

## 📖 Game Settings

For a detailed explanation of game mechanics, character behaviors, perception systems, and weapon stats, please refer to:
👉 **[Game Settings Guide](doc/game_settings.md)**

---

## 📜 Changelog

To understand the detailed update history of the project (including specific improvements in each version), please refer to:
👉 **[CHANGELOG.md](CHANGELOG.md)**

---

<div align="center">
  Under continuous development... Issues or Pull Requests are welcome!
</div>
