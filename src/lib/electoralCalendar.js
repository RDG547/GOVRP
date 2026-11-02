import { fromBrasiliaInput } from './dateTime.js';

export const electoralCalendarDates = [
  ['candidacy_start_date', 'Início das candidaturas'],
  ['candidacy_end_date', 'Fim das candidaturas'],
  ['voting_start_date', 'Início da votação'],
  ['voting_end_date', 'Fim da votação'],
];

export function electoralCalendarPayload(draft) {
  const payload = {
    name: draft.name?.trim() || '',
    description: draft.description || '',
    election_type_id: draft.election_type_id,
  };
  if (payload.name.length < 5) throw new Error('Informe um nome de eleição com pelo menos 5 caracteres.');
  if (!payload.election_type_id) throw new Error('Selecione o tipo de eleição.');
  for (const [key, label] of electoralCalendarDates) {
    payload[key] = fromBrasiliaInput(draft[key]);
    if (!payload[key]) throw new Error(`Preencha “${label}” com uma data e um horário válidos de Brasília.`);
  }
  if (draft.seats_available !== undefined && draft.seats_available !== null && draft.seats_available !== '') {
    const seats = Number(draft.seats_available);
    if (!Number.isInteger(seats) || seats < 1 || seats > 513) {
      throw new Error('Informe de 1 a 513 cadeiras disponíveis.');
    }
    payload.seats_available = seats;
  }
    // The server validates whether candidacy is still in the future; a device
  // with an incorrect clock must not decide the world's current time.
  if (Date.parse(payload.candidacy_end_date) <= Date.parse(payload.candidacy_start_date)) {
    throw new Error('O fim das candidaturas deve ser posterior ao início das candidaturas.');
  }
  if (Date.parse(payload.voting_start_date) < Date.parse(payload.candidacy_end_date)) {
    throw new Error('A votação deve começar no mesmo horário ou depois do fim das candidaturas.');
  }
  if (Date.parse(payload.voting_end_date) <= Date.parse(payload.voting_start_date)) {
    throw new Error('O fim da votação deve ser posterior ao início da votação.');
  }
  return payload;
}
