// Perfil baseline Speculum — software WebRender (produção sem GPU).
// mirror: once — deve existir antes do processo subir (user.js no profile).
user_pref("gfx.webrender.software", true);
user_pref("gfx.webrender.enabled", true);
user_pref("layers.acceleration.disabled", true);
user_pref("layers.acceleration.force-enabled", false);
user_pref("gfx.webrender.compositor", true);
