import { configureStore } from '@reduxjs/toolkit'
import campaignReducer from './campaignSlice'

export const store = configureStore({
    reducer: {
        campaigns: campaignReducer
    }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
