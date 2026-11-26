// Englisches Wörterbuch: deutscher Ausgangstext → englischer Text. Je Bereich eine Datei, damit
// Änderungen übersichtlich bleiben. Die Begriffe stehen oben in js/i18n.js.
import { EN_BASE } from './en-base.js'
import { EN_BOARD } from './en-board.js'
import { EN_COMM } from './en-comm.js'
import { EN_MORE } from './en-more.js'

export const EN = { ...EN_BASE, ...EN_BOARD, ...EN_COMM, ...EN_MORE }
