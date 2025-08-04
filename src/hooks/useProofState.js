import { useState, useEffect } from 'react'
const k = (fileId) => `bat-proofmeta::${fileId}`

export function useProofState(fileId) {
  const [state, setState] = useState(()=> {
    try { return JSON.parse(localStorage.getItem(k(fileId)) || 'null') || { locked:false, approvedAt:null } }
    catch { return { locked:false, approvedAt:null } }
  })
  useEffect(()=> localStorage.setItem(k(fileId), JSON.stringify(state)), [fileId, state])

  const approve = () => setState({ locked:true, approvedAt: Date.now() })
  const unlock  = () => setState({ locked:false, approvedAt:null })

  return { ...state, approve, unlock }
}
