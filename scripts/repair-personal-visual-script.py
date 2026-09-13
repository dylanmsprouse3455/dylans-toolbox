from pathlib import Path
p=Path('scripts/add-personal-visual-library.py')
text=p.read_text()
text=text.replace("if(requestMode==='overdue'){\n\"", "if(requestMode==='overdue'){\\n\"")
p.write_text(text)
