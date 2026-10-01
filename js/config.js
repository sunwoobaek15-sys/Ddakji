/* CODEMATE — global configuration.
 * Change PARTNER_NAME to rename the AI partner everywhere (players can also rename it in Settings). */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  CM.CONFIG = {
    GAME_TITLE: 'CODEMATE',
    SUBTITLE: 'Your AI coding partner.',
    PARTNER_NAME: 'CLAUDE',
    // Backend base URL. The browser never talks to an AI provider directly and never holds an API key.
    API_BASE: '/api',
    SAVE_KEY: 'codemate.save.v1',
    SAVE_VERSION: 1,
    ANALYZE_DELAY_DEFAULT: 600, // ms after the player stops typing
    ANALYZE_DELAY_MIN: 300,
    ANALYZE_DELAY_MAX: 800,
    DEEP_ANALYZE_DELAY: 3500, // online deep review waits much longer (and is opt-in)
    HEALTH_RETRY_MS: 60000,
    RUN_TIMEOUT_MS: 4000,
    MAX_FILES: 30,
    MAX_PROJECTS: 30,
    MAX_FILE_CHARS: 200000,
    PLAYER_SPEED: 210, // world units per second
    XP: {
      TYPO_FIX: 5,
      SYNTAX_FIX: 10,
      CLEANUP: 5,
      REFACTOR: 10,
      RUNTIME_FIX: 15,
      FIRST_RUN: 10,
      MISSION: 50,
      PROJECT: 100
    }
  };
})(typeof self !== 'undefined' ? self : this);
