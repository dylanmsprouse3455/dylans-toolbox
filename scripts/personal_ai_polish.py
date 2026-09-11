from pathlib import Path
p=Path('app/toolbox.tsx')
text=p.read_text()
replacements={
"    setError('');setFeedback(online?'Saved on this device. Organizing your thoughts…':'Saved on this device. We’ll organize it when you reconnect.');":"    setError('');setFeedback(capture.channel==='ai'?(online?'Sending to Orbit…':'Saved on this device. It’ll send when you reconnect.'):(online?'Saved on this device. Organizing your thoughts…':'Saved on this device. We’ll organize it when you reconnect.'));",
"    await queue({id:crypto.randomUUID(),user_id:owner,text:message,captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:lastTurnRef.current?.id,channel:'ai'});":"    await queue({id:crypto.randomUUID(),user_id:owner,text:message,captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:aiHistory.at(-1)?.id,channel:'ai'});",
"    const conversation={reply_to:channel==='ai'?lastTurnRef.current?.id:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,focus_id:focusId,channel};":"    const conversation={reply_to:channel==='ai'?aiHistory.at(-1)?.id:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,focus_id:focusId,channel};",
"}{lastTurn&&!aiHistory.some(turn=>turn.id===lastTurn.id)&&<div className={'ai-orbit '+(lastTurn.needs_clarification?'question':'')}><span>{lastTurn.needs_clarification?'Orbit needs one detail':'Orbit'}</span><p>{lastTurn.reply}</p></div>}{pending.filter(capture=>capture.channel==='ai')":"}{pending.filter(capture=>capture.channel==='ai')",
}
for old,new in replacements.items():
    if old not in text: raise SystemExit('Missing polish target: '+old[:100])
    text=text.replace(old,new,1)
p.write_text(text)
