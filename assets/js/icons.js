"use strict";

/* ---------- icons (lucide-style inline svg) ---------- */
var ICONS = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>',
  wallet:'<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"></path><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"></path><circle cx="17" cy="14" r="1.1"></circle>',
  chef:'<path d="M6 13a4 4 0 1 1 1.2-7.8 3.5 3.5 0 0 1 6.6-1 3.5 3.5 0 0 1 6.2 2.3A4 4 0 0 1 18 13"></path><path d="M6 13h12v3a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"></path><path d="M9 21h6"></path>',
  utensils:'<path d="M6 3v7a2 2 0 0 0 2 2v9"></path><path d="M6 3v4M9 3v4"></path><path d="M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8"></path>',
  package:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"></path><path d="M3 8l9 5 9-5"></path><path d="M12 13v8"></path>',
  landmark:'<path d="M3 21h18"></path><path d="M4 10h16"></path><path d="M12 3 3 10h18z"></path><path d="M6 10v8M10 10v8M14 10v8M18 10v8"></path>',
  chart:'<path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M4 20h16"></path>',
  users:'<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><circle cx="17.5" cy="9" r="2.3"></circle><path d="M15 20a5 5 0 0 1 7-4.6"></path>',
  settings:'<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"></path>',
  flame:'<path d="M12 2s-6 6.5-6 11.5a6 6 0 0 0 12 0C18 12 17 10.7 16.3 9.5c0 1.4-.7 2.2-1.4 2.7C15.6 9.8 14.3 7 12 5c.3 1.6-.3 2.6-1.2 3.2C10 6.5 12 4 12 2z"></path>',
  plus:'<path d="M12 5v14M5 12h14"></path>',
  minus:'<path d="M5 12h14"></path>',
  x:'<path d="M18 6 6 18M6 6l12 12"></path>',
  check:'<path d="M20 6 9 17l-5-5"></path>',
  clock:'<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path>',
  alert:'<path d="m12 3 9.5 17H2.5z"></path><path d="M12 10v4"></path><circle cx="12" cy="17.3" r=".6" fill="currentColor" stroke="none"></circle>',
  arrowLeft:'<path d="M19 12H5"></path><path d="M11 18l-6-6 6-6"></path>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"></path>',
  search:'<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
  trash:'<path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M6 7l1 13h10l1-13"></path>',
  more:'<circle cx="5" cy="12" r="1.3"></circle><circle cx="12" cy="12" r="1.3"></circle><circle cx="19" cy="12" r="1.3"></circle>',
  door:'<path d="M15 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h9"></path><path d="M15 3v18"></path><path d="M10 12h9m0 0-3-3m3 3-3 3"></path>',
  wifiOff:'<path d="M2 2l20 20"></path><path d="M8.5 15.5a6 6 0 0 1 4.7-1.9"></path><path d="M5 12a11 11 0 0 1 4-2.3"></path><path d="M19 12a11 11 0 0 0-2.6-1.9"></path><path d="M2 8.5a16 16 0 0 1 5-3"></path><path d="M22 8.5a16 16 0 0 0-4.2-2.8"></path><circle cx="12" cy="19" r="1"></circle>',
  edit:'<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>'
};
function icon(name, size, cls){
  size = size||18;
  return '<svg class="'+(cls||'')+'" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[name]||'')+'</svg>';
}
