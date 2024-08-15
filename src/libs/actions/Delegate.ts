import Onyx from 'react-native-onyx';
import type {OnyxUpdate} from 'react-native-onyx';
import * as API from '@libs/API';
import type {AddDelegateParams} from '@libs/API/parameters';
import {SIDE_EFFECT_REQUEST_COMMANDS, WRITE_COMMANDS} from '@libs/API/types';
import Log from '@libs/Log';
import * as NetworkStore from '@libs/Network/NetworkStore';
import * as SequentialQueue from '@libs/Network/SequentialQueue';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {DelegatedAccess, DelegateRole} from '@src/types/onyx/Account';
import {openApp} from './App';
import updateSessionAuthTokens from './Session/updateSessionAuthTokens';

let delegatedAccess: DelegatedAccess;
Onyx.connect({
    key: ONYXKEYS.ACCOUNT,
    callback: (val) => {
        delegatedAccess = val?.delegatedAccess ?? {};
    },
});

const KEYS_TO_PRESERVE_DELEGATE_ACCESS = [ONYXKEYS.NVP_TRY_FOCUS_MODE, ONYXKEYS.PREFERRED_THEME, ONYXKEYS.NVP_PREFERRED_LOCALE, ONYXKEYS.SESSION];

function connect(email: string) {
    if (!delegatedAccess?.delegators) {
        return;
    }

    const optimisticData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegators: delegatedAccess.delegators.map((delegator) => (delegator.email === email ? {...delegator, error: undefined} : delegator)),
                },
            },
        },
    ];

    const successData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegators: delegatedAccess.delegators.map((delegator) => (delegator.email === email ? {...delegator, error: undefined} : delegator)),
                },
            },
        },
    ];

    const failureData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegators: delegatedAccess.delegators.map((delegator) => (delegator.email === email ? {...delegator, error: 'delegate.genericError'} : delegator)),
                },
            },
        },
    ];

    // eslint-disable-next-line rulesdir/no-api-side-effects-method
    API.makeRequestWithSideEffects(SIDE_EFFECT_REQUEST_COMMANDS.CONNECT_AS_DELEGATE, {to: email}, {optimisticData, successData, failureData})
        .then((response) => {
            if (!response?.restrictedToken || !response?.encryptedAuthToken) {
                Log.alert('[Delegate] No auth token returned while connecting as a delegate');
                Onyx.update(failureData);
                return;
            }
            return SequentialQueue.waitForIdle()
                .then(() => Onyx.clear(KEYS_TO_PRESERVE_DELEGATE_ACCESS))
                .then(() => {
                    // Update authToken in Onyx and in our local variables so that API requests will use the new authToken
                    updateSessionAuthTokens(response?.restrictedToken, response?.encryptedAuthToken);

                    NetworkStore.setAuthToken(response?.restrictedToken ?? null);
                    openApp();
                });
        })
        .catch((error) => {
            Log.alert('[Delegate] Error connecting as delegate', {error});
            Onyx.update(failureData);
        });
}

function clearDelegatorErrors() {
    if (!delegatedAccess?.delegators) {
        return;
    }
    Onyx.merge(ONYXKEYS.ACCOUNT, {delegatedAccess: {delegators: delegatedAccess.delegators.map((delegator) => ({...delegator, error: undefined}))}});
}

function addDelegate(email: string, role: DelegateRole) {
    if (!delegatedAccess?.delegates) {
        return;
    }

    const optimisticData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegates: [
                        ...delegatedAccess.delegates,
                        {email, role, pendingAction: 'add', pendingFields: {email: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD, role: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD}},
                    ],
                },
            },
        },
    ];

    const successData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegates: [...delegatedAccess.delegates, {email, role, error: undefined, pendingAction: null, pendingFields: {email: null, role: null}}],
                },
            },
        },
    ];

    const failureData: OnyxUpdate[] = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.ACCOUNT,
            value: {
                delegatedAccess: {
                    delegates: delegatedAccess.delegates.map((delegate) => (delegate.email !== email ? delegate : {...delegate, error: 'delegate.genericError'})),
                },
            },
        },
    ];

    const parameters: AddDelegateParams = {email, role};

    API.write(WRITE_COMMANDS.ADD_DELEGATE, parameters, {optimisticData, successData, failureData});
}

// eslint-disable-next-line import/prefer-default-export
export {connect, clearDelegatorErrors, addDelegate};
