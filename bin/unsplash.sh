#!/bin/bash

set -e

index=$[ 1 + $[ RANDOM % 10 ]]
img=`curl https://unsplash.com/rss/ | xmllint --xpath '/rss/channel/item['$index']/image/url/text()' -`
curl "$img" > ~/unsplash-latest.jpg
mogrify -fill '#002833' -resize 1280x -colorize 50% ~/unsplash-latest.jpg
osascript -e 'tell application "iTerm" to set background image path of current session of current terminal to "'$HOME'/unsplash-latest.jpg"'

