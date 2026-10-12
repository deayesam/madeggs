(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MECHARS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Abilities are NEVER attached to characters. Only looks, voice and attitude live here.
  return [
    { id: 'bulalaman', name: 'BULALAMAN', color: '#a45cff', dark: '#5a2bb0', tag: 'Fearless. Loud. Already charging.',
      shout: 'CHAAARGE!', bio: 'Has never once checked the map.' },
    { id: 'ayesam', name: 'AYE SAM', color: '#ffcb2f', dark: '#b5850a', tag: 'Strategic, clever, always adapting.',
      shout: 'Calculated.', bio: 'Already knows what you will do. Smiling about it.' },
    { id: 'crazysam', name: 'CRAZYSAM', color: '#38e07b', dark: '#0f8f46', tag: 'Unpredictable. Reckless. Chaos.',
      shout: 'WHEEEEE!', bio: 'Plan A was a coin flip. Plan B was also a coin flip.' },
    { id: 'lawrence', name: 'LAWRENCE', color: '#3b9dff', dark: '#1a5fb8', tag: 'Calm, analytical, tactical.',
      shout: 'As predicted.', bio: 'Reads the room. Then reads your next move.' }
  ];
});
