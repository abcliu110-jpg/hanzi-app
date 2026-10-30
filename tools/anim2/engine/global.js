/* IIFE 入口：挂到 window.XZQAnim2；页面里没有 v1 时也挂成 window.XZQAnim（同一套 API） */
import * as API from './index.js';
const G = typeof window !== 'undefined' ? window : globalThis;
const api = { mount: API.mount, load: API.load, needs: API.needs, Player: API.Player, SLOTS: API.SLOTS, PAL: API.PAL, version: 2 };
G.XZQAnim2 = api;
if (!G.XZQAnim || G.XZQ_ANIM_V2) G.XZQAnim = api;
