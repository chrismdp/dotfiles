#!/bin/bash

if [ ! -z "$(find ~/.mail/*/INBOX -type f)" ]; then
  printf '📬  '
  for box in `ls ~/.mail | grep -v temp`; do
    box_emails=$(find ~/.mail/$box/INBOX -type f | wc -l)
    [ $box_emails -ne 0 ] && printf '%s' ${box:0:1}
  done
  #all=$(find ~/.mail/*/INBOX/ -type f | wc -l)
  #[ $all -ne 0 ] && printf '%d' $all
  unimportant=$(find -f ~/.mail/Personal/github ~/.mail/Personal/list -type f | wc -l)
  [ $unimportant -ne 0 ] && printf 'U' $unimportant
else
  printf '📪 '
fi

if [ ! -z "$(find ~/.msmtp.queue/ -name '*.mail')" ]; then
  printf ' ✉️  '
  all=$(find ~/.msmtp.queue/ -name '*.mail' | wc -l)
  [ $all -ne 0 ] && printf '%d' $all
fi

if [ ! -z "$(ps ax | grep offlineimap | grep -v grep)" ]; then
  printf '🔹 '
fi

printf '\n'
