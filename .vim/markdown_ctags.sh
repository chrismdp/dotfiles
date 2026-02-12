#!/bin/bash
# Custom markdown ctags that handles --- horizontal rules correctly.
# ctags-universal 5.9.0 confuses --- separators with YAML frontmatter.
FILE="$1"
awk '
BEGIN { in_frontmatter = 0; in_codeblock = 0; h1 = ""; h2 = ""; h3 = "" }
NR == 1 && /^---$/ { in_frontmatter = 1; next }
in_frontmatter && /^---$/ { in_frontmatter = 0; next }
in_frontmatter { next }
/^```/ { in_codeblock = !in_codeblock; next }
in_codeblock { next }
/^# / {
  name = $0; sub(/^# /, "", name)
  h1 = name; h2 = ""; h3 = ""
  printf "%s\t%s\t/^# %s$/;\"\tc\n", name, FILENAME, name
}
/^## / {
  name = $0; sub(/^## /, "", name)
  h2 = name; h3 = ""
  if (h1 != "")
    printf "%s\t%s\t/^## %s$/;\"\ts\tchapter:%s\n", name, FILENAME, name, h1
  else
    printf "%s\t%s\t/^## %s$/;\"\ts\n", name, FILENAME, name
}
/^### / {
  name = $0; sub(/^### /, "", name)
  h3 = name
  if (h2 != "")
    printf "%s\t%s\t/^### %s$/;\"\tS\tsection:%s\n", name, FILENAME, name, h2
  else if (h1 != "")
    printf "%s\t%s\t/^### %s$/;\"\tS\tchapter:%s\n", name, FILENAME, name, h1
  else
    printf "%s\t%s\t/^### %s$/;\"\tS\n", name, FILENAME, name
}
/^#### / {
  name = $0; sub(/^#### /, "", name)
  if (h3 != "")
    printf "%s\t%s\t/^#### %s$/;\"\tt\tsubsection:%s\n", name, FILENAME, name, h3
  else if (h2 != "")
    printf "%s\t%s\t/^#### %s$/;\"\tt\tsection:%s\n", name, FILENAME, name, h2
  else
    printf "%s\t%s\t/^#### %s$/;\"\tt\n", name, FILENAME, name
}
' "$FILE"
