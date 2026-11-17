// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+): the tablet operations
// that take parameters a device feature cannot carry (a TTS language, an
// audio URL with its volume...), placed by the user in a scene.
//
// Each handler receives the RESOLVED fields (scene variables substituted,
// validated by the core); throwing fails this action only, the scene goes on.
// The scene TRIGGER (tablet_availability_changed) needs no handler: the
// service fires it with publishSceneEvent (see src/tabletService.js).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  load_url: (service, fields) => service.sceneLoadUrl(fields),
  speak: (service, fields) => service.sceneSpeak(fields),
  show_message: (service, fields) => service.sceneShowMessage(fields),
  play_audio: (service, fields) => service.scenePlayAudio(fields),
  stop_audio: (service, fields) => service.sceneStopAudio(fields),
  take_photo: (service, fields) => service.sceneTakePhoto(fields),
};

// Manifest `actions` (buttons of the Configuration screen).
export const MANIFEST_ACTIONS = {
  scan_now: (service) => service.actionScan(),
  add_tablet: (service, fields) => service.actionAddTablet(fields),
  set_api_key: (service, fields) => service.actionSetApiKey(fields),
  update_address: (service, fields) => service.actionUpdateAddress(fields),
  identify: (service, fields) => service.actionIdentify(fields),
};
