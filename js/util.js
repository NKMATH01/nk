/* 순수 유틸리티. DOM 조회($)를 제외하면 부수효과가 없다. */
import { TODAY } from './config.js';

/* ═══════════ 유틸 ═══════════ */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function $(id){return document.getElementById(id);}
function clamp(n,lo=0,hi=100){n=Number(n);if(isNaN(n))return lo;return Math.max(lo,Math.min(hi,n));}
function r1(n){return n==null?null:Math.round(n*10)/10;}
function normPhone(s){return String(s||'').replace(/[^0-9]/g,'');}
function uuid(){return (crypto.randomUUID?crypto.randomUUID():'id-'+Math.random().toString(16).slice(2)+Date.now().toString(16));}
function pad(n){return String(n).padStart(2,'0');}
function todayStr(){const d=TODAY;return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function fmtDate(s){return s?String(s).slice(0,10):'';}
function daysUntil(s){if(!s)return null;const t=new Date(s+'T00:00:00');return Math.round((t-TODAY)/86400000);}
function ddayLabel(s){const d=daysUntil(s);if(d==null)return '';return d>=0?'D-'+d:'D+'+(-d);}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

export { esc, $, clamp, r1, normPhone, uuid, pad, todayStr, fmtDate, daysUntil, ddayLabel, mulberry32 };
