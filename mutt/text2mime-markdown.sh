#!/bin/bash

cat $1 | sed '1,/^$/d' | /usr/local/share/npm/bin/mdown --header "/Users/chris/.mutt/text2mime-markdown-header.html" --footer "/Users/chris/.mutt/text2mime-markdown-footer.html" > /tmp/html-markdown-alternative.html
