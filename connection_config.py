"""Keep the local extension pairing secret stable across Studio restarts."""
import json,re,uuid
from pathlib import Path
from core import atomic

def load_token(path):
    path=Path(path)
    if path.exists():
        try:
            value=json.loads(path.read_text(encoding='utf8'))['token']
            if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{32}',value):raise ValueError('invalid token')
            return value
        except (ValueError,KeyError,TypeError) as error:
            raise ValueError('studio_connection.json bi loi. Khoi phuc file ket noi hoac doi ten file de ghep lai tien ich.') from error
    value=uuid.uuid4().hex;atomic(path,{'token':value});return value
