from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Missing patch target in {path}: {old[:120]}')
    p.write_text(text.replace(old, new, 1))

# Keep the review collapsed by default and reset it for each proposal.
replace_once(
    'app/work-toolbox.tsx',
    "  const [wizard,setWizard]=useState<WorkPreviewReceipt|null>(null),[wizardIndex,setWizardIndex]=useState(0),[correcting,setCorrecting]=useState(false),[correction,setCorrection]=useState('');",
    "  const [wizard,setWizard]=useState<WorkPreviewReceipt|null>(null),[wizardIndex,setWizardIndex]=useState(0),[correcting,setCorrecting]=useState(false),[correction,setCorrection]=useState(''),[showWizardDetails,setShowWizardDetails]=useState(false);"
)
replace_once(
    'app/work-toolbox.tsx',
    "    setWizard(receipt);setWizardIndex(0);setCorrecting(false);setCorrection('');setReply('');setApprovedRuleKeys([]);",
    "    setWizard(receipt);setWizardIndex(0);setCorrecting(false);setCorrection('');setShowWizardDetails(false);setReply('');setApprovedRuleKeys([]);"
)
replace_once(
    'app/work-toolbox.tsx',
    "    if(wizardIndex<wizard.preview.proposals.length-1){setWizardIndex(index=>index+1);setCorrecting(false);setCorrection('');return;}",
    "    if(wizardIndex<wizard.preview.proposals.length-1){setWizardIndex(index=>index+1);setCorrecting(false);setCorrection('');setShowWizardDetails(false);return;}"
)

p = Path('app/work-toolbox.tsx')
text = p.read_text()
start_marker = '    {wizard&&currentProposal&&<div className="work-overlay" role="dialog" aria-modal="true" aria-label="Confirm Work update">'
end_marker = '\n\n    {selected&&<div className="work-overlay" role="dialog" aria-modal="true" aria-label="Work file details">'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Work wizard block')

new_block = '''    {wizard&&currentProposal&&<div className="work-overlay work-wizard-overlay" role="dialog" aria-modal="true" aria-label="Confirm Work update"><section className={'work-wizard '+(showWizardDetails?'expanded':'compact')}><div className="work-wizard-top"><div><p className="work-step">Check {wizardIndex+1} of {wizard.preview.proposals.length}</p><h2>{currentProposal.case_number||'Work item'}</h2></div><Button size="icon" variant="ghost" aria-label="Cancel draft" onClick={()=>void discardWizard()} disabled={busy}><X/></Button></div><div className="work-wizard-question work-wizard-question-primary"><span className="work-wizard-question-label">Orbit understood</span><strong>{currentProposal.confirmation_question}</strong></div><button type="button" className="work-wizard-details-toggle" aria-expanded={showWizardDetails} onClick={()=>setShowWizardDetails(value=>!value)}><Eye/>{showWizardDetails?'Hide full case':'View full case'}</button>{showWizardDetails&&<div className="work-wizard-expanded"><div className="work-wizard-file"><span className="work-case-badge">{currentProposal.case_number||'Work item'}</span><h3>{currentProposal.title}</h3><div className="work-wizard-chips"><span>{stateLabel[currentProposal.workflow_state]}</span><span>{ballLabel(currentProposal.ball_owner,currentProposal.ball_with)}</span>{currentProposal.status==='completed'&&<span>Completed</span>}<span className={'match-'+currentProposal.match_confidence}>{currentProposal.match_confidence==='high'?'Strong match':currentProposal.match_confidence==='medium'?'Likely match':'Needs care'}</span></div></div><div className="work-match-note"><strong>Matched by:</strong> {currentProposal.match_reason}</div><dl className="work-wizard-details"><div><dt>Current situation</dt><dd>{currentProposal.current_situation||'—'}</dd></div><div><dt>Next action</dt><dd>{currentProposal.next_action||'Nothing specific yet'}</dd></div><div><dt>When to care again</dt><dd>{dueLabel(currentProposal.follow_up_at,currentProposal.follow_up_date)||'No follow-up set'}</dd></div>{currentProposal.follow_up_condition&&<div><dt>Only if</dt><dd>{currentProposal.follow_up_condition}</dd></div>}{currentProposal.closing_date&&<div><dt>Closing</dt><dd>{dateLabel(currentProposal.closing_date)}</dd></div>}<div><dt>Timeline entry</dt><dd>{currentProposal.event_summary}</dd></div>{currentProposal.fact_changes.length>0&&<div><dt>Permanent facts</dt><dd>{currentProposal.fact_changes.map((fact,index)=><span className="work-fact-preview" key={fact.action+'-'+fact.key+'-'+index}>{fact.action==='remove'?'Remove ':'Save '}{fact.key.replaceAll('_',' ')}: {fact.value}</span>)}</dd></div>}</dl>{wizard.preview.rule_suggestions.length>0&&wizardIndex===0&&<div className="work-rule-suggestions"><p className="work-step">Optional rulebook</p>{wizard.preview.rule_suggestions.map(rule=><div className="work-rule-suggestion" key={rule.rule_key}><div><strong>{rule.rule_text}</strong><p>{rule.reason}</p></div>{approvedRuleKeys.includes(rule.rule_key)?<span className="work-rule-approved"><Check/>Learned</span>:<Button type="button" variant="outline" disabled={ruleBusy===rule.rule_key||busy} onClick={()=>void approveRule(rule)}>{ruleBusy===rule.rule_key?<LoaderCircle className="spinning"/>:<Sparkles/>}Teach Orbit</Button>}</div>)}</div>}</div>}{!correcting?<div className="work-wizard-actions"><Button className="work-confirm-yes" onClick={()=>void confirmWizardStep()} disabled={busy}>{busy?<LoaderCircle className="spinning"/>:<><Check/>Yes, that’s right</>}</Button><Button variant="outline" onClick={()=>setCorrecting(true)} disabled={busy}><X/>No, change it</Button></div>:<div className="work-correction"><label>What did Orbit get wrong, or what should be different?<Textarea autoFocus value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Example: I’m waiting on Sarah, not Mike, and I don’t need to follow up until Tuesday." maxLength={5000}/></label><div className="work-wizard-actions"><Button onClick={()=>void reviseWizard()} disabled={busy||!correction.trim()}>{busy?<LoaderCircle className="spinning"/>:<><Send/>Fix the draft</>}</Button><Button variant="outline" onClick={()=>{setCorrecting(false);setCorrection('');}} disabled={busy}>Back</Button></div></div>}<p className="work-wizard-note">Nothing is saved until you confirm.</p></section></div>}'''
text = text[:start] + new_block + text[end:]
p.write_text(text)

# Append mobile-safe scrolling and compact review styles.
css = Path('app/work-toolbox.css')
css_text = css.read_text()
addition = r'''

/* compact confirmation-first Work wizard */
.work-wizard-overlay{overflow:hidden;align-items:center}
.work-wizard{max-height:calc(100dvh - max(24px,env(safe-area-inset-top)) - max(24px,env(safe-area-inset-bottom)));overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-gutter:stable}
.work-wizard.compact{max-width:560px}
.work-wizard-question-primary{margin:20px 0 0;padding:22px 20px;border:1px solid #d7e8fb;background:linear-gradient(180deg,#f5faff 0%,#edf6ff 100%);color:#173f6b;box-shadow:0 10px 28px #245d9b0d}
.work-wizard-question-primary strong{display:block;font-size:1.08rem;line-height:1.5;letter-spacing:-.01em}
.work-wizard-question-label{display:block;margin-bottom:7px;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5d7fa6}
.work-wizard-details-toggle{width:100%;margin-top:10px;border:0;background:transparent;color:#315f90;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border-radius:12px;font-size:.84rem;font-weight:750}
.work-wizard-details-toggle:active{background:#f1f6fc}
.work-wizard-details-toggle svg{width:17px;height:17px}
.work-wizard-expanded{margin-top:2px}
.work-wizard.compact .work-wizard-actions{margin-top:12px}
@media(max-width:520px){
  .work-wizard-overlay{align-items:flex-end;padding-top:max(8px,env(safe-area-inset-top));padding-bottom:max(8px,env(safe-area-inset-bottom))}
  .work-wizard{width:100%;max-height:calc(100dvh - max(8px,env(safe-area-inset-top)) - max(8px,env(safe-area-inset-bottom)));overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}
  .work-wizard.compact{padding:18px 15px calc(18px + env(safe-area-inset-bottom));}
  .work-wizard-question-primary{padding:19px 17px}
  .work-wizard-question-primary strong{font-size:1.04rem}
}
'''
if '/* compact confirmation-first Work wizard */' not in css_text:
    css.write_text(css_text + addition)

# Add a source-level regression test for the compact wizard and iPhone scrolling contract.
test = Path('tests/work-wizard-ui.test.ts')
test.write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFile} from 'node:fs/promises';\n\ntest('Work wizard defaults to confirmation-first with optional full details and mobile scrolling',async()=>{\n  const tsx=await readFile(new URL('../app/work-toolbox.tsx',import.meta.url),'utf8');\n  const css=await readFile(new URL('../app/work-toolbox.css',import.meta.url),'utf8');\n  assert.match(tsx,/showWizardDetails,setShowWizardDetails/);\n  assert.match(tsx,/View full case/);\n  assert.match(tsx,/Orbit understood/);\n  assert.match(tsx,/showWizardDetails&&<div className=\\\"work-wizard-expanded\\\">/);\n  assert.match(css,/compact confirmation-first Work wizard/);\n  assert.match(css,/max-height:calc\\(100dvh/);\n  assert.match(css,/-webkit-overflow-scrolling:touch/);\n  assert.match(css,/touch-action:pan-y/);\n});\n""")
