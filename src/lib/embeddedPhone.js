// The phone loads the existing authenticated routes in a same-origin viewport.
// This affects presentation only; every service keeps its server authorization.
export const isEmbeddedPhone = () => typeof window !== 'undefined' && window.parent !== window && window.name === 'govrp-phone-app';
