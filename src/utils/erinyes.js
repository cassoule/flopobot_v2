export const roles = {
    erynie_1: {
        name: 'Erinye',
        subtitle: 'Mégère, la haine',
        descr: '',
        powers: {
            double_vote: {
                descr: 'Les Erinyes peuvent tuer une deuxième personne (1 seule fois).',
                charges: 1,
                disabled: false,
            },
        },
        passive: {},
        team: 'Erinyes',
    },
    erynie_2: {
        name: 'Erinye',
        subtitle: 'Tisiphone, la vengeance',
        descr: '',
        powers: {
            one_shot: {
                descr: 'Tuer une personne de son choix en plus du vote des Erinyes (1 seule fois).',
                charges: 1,
                disabled: false,
            },
        },
        passive: {},
        team: 'Erinyes',
    },
    erynie_3: {
        name: 'Erinye',
        subtitle: 'Alecto, l\'implacable',
        descr: '',
        powers: {
            silence: {
                descr: 'Empêche l\'utilisation du pouvoir de quelqu\'un pour le prochain tour.',
                charges: 999,
                disabled: false,
            }
        },
        passive: {
            descr: 'Voit quels pouvoirs ont été utilisés.',
            disabled: false,
        },
        team: 'Erinyes',
    },
    narcisse: {
        name: 'Narcisse',
        subtitle: '',
        descr: '',
        powers: {},
        passive: {
            descr: 'S\'il devient maire ...',
            disabled: false,
        },
    },
    charon: {
        name: 'Charon',
        subtitle: 'Sorcier',
        descr: 'C\'est le passeur, il est appelé chaque nuit après les Erinyes pour décider du sort des mortels.',
        powers: {
            revive: {
                descr: 'Refuser de faire traverser le Styx (sauver quelqu\'un)',
                charges: 1,
                disabled: false,
            },
            kill: {
                descr: 'Traverser le Styx (tuer quelqu\'un)',
                charges: 1,
                disabled: false,
            }
        },
    },
    //...
}