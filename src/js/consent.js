(() => {
 "use strict";
 const storageKey = "peakfresh-consent-v1";
 const consentVersion = 1;
 let settingsTrigger = null;
 function readConsent() {
  try { const saved=JSON.parse(localStorage.getItem(storageKey)||"null"); return saved?.version===consentVersion?saved:null; }
  catch { return null; }
 }
 function closeSettings(overlay) { overlay.remove(); if(settingsTrigger?.isConnected)settingsTrigger.focus(); settingsTrigger=null; }
 function saveConsent(choice) {
  try { localStorage.setItem(storageKey,JSON.stringify({version:consentVersion,choice,updatedAt:new Date().toISOString()})); } catch {}
  document.querySelector(".cookie-banner")?.remove();
  const overlay=document.querySelector(".cookie-settings-backdrop");
  if(overlay)closeSettings(overlay);
 }
 function openSettings(trigger=document.activeElement) {
  if(document.querySelector(".cookie-settings-backdrop"))return;
  settingsTrigger=trigger;
  const overlay=document.createElement("div");
  overlay.className="cookie-settings-backdrop";
  overlay.innerHTML='<section class="cookie-settings" role="dialog" aria-modal="true" aria-labelledby="cookie-settings-title"><h2 id="cookie-settings-title">Cookie and storage preferences</h2><p>Essential browser storage supports sign-in and security and cannot be switched off. No optional analytics or marketing technologies are currently installed.</p><label><input type="checkbox" checked disabled> Essential authentication and security storage</label><div class="cookie-actions"><button type="button" data-save-essential>Save essential only</button><button type="button" data-close-settings>Close</button></div></section>';
  document.body.appendChild(overlay);
  const closeButton=overlay.querySelector("[data-close-settings]");
  overlay.querySelector("[data-save-essential]").addEventListener("click",()=>saveConsent("essential-only"));
  closeButton.addEventListener("click",()=>closeSettings(overlay));
  overlay.addEventListener("click",event=>{if(event.target===overlay)closeSettings(overlay)});
  overlay.addEventListener("keydown",event=>{
   if(event.key==="Escape"){event.preventDefault();closeSettings(overlay);return}
   if(event.key!=="Tab")return;
   const controls=[...overlay.querySelectorAll("button:not(:disabled)")];
   if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls[controls.length-1].focus()}
   else if(!event.shiftKey&&document.activeElement===controls[controls.length-1]){event.preventDefault();controls[0].focus()}
  });
  closeButton.focus();
 }
 function showBanner() {
  if(readConsent()||document.querySelector(".cookie-banner"))return;
  const banner=document.createElement("section");
  banner.className="cookie-banner";
  banner.setAttribute("role","region");
  banner.setAttribute("aria-labelledby","cookie-banner-title");
  banner.innerHTML='<h2 id="cookie-banner-title">Your privacy choices</h2><p>Peak Fresh uses essential browser storage for account sign-in and security. No optional analytics or marketing technologies are installed. You can revisit this choice in Cookie Settings.</p><div class="cookie-actions"><button type="button" data-consent-all>Accept all</button><button type="button" data-consent-reject>Reject optional</button><button type="button" data-consent-manage>Manage preferences</button></div>';
  document.body.appendChild(banner);
  banner.querySelector("[data-consent-all]").addEventListener("click",()=>saveConsent("all-current"));
  banner.querySelector("[data-consent-reject]").addEventListener("click",()=>saveConsent("essential-only"));
  banner.querySelector("[data-consent-manage]").addEventListener("click",event=>openSettings(event.currentTarget));
 }
 document.addEventListener("click",event=>{
  const trigger=event.target.closest("[data-open-cookie-settings]");
  if(trigger){event.preventDefault();openSettings(trigger)}
 });
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",showBanner,{once:true});else showBanner();
})();