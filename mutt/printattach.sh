#!/bin/bash
# http://wcm1.web.rice.edu/mutt-tips.html
# Mutt puts everything in /tmp by default.
# This gets the basic filename from the full pathname.

newfile=`basename $1`.html

# Copy the file to our new spot so mutt will not delete it
# before the script has a chance to print it.

cp $1 $newfile

set -e
set -x

# Prompt user for desired script.

read -p "Save where? (r)eceipts or (e)xpenses? " -n 1 SWITCH

if [ $SWITCH = "e" ]; then
  path="/Users/chris/Dropbox/Think Code Learn Ltd/Receipts/1. Receipts to be entered in Xero"
elif [ $SWITCH = "r" ]; then
  path="/Users/chris/Dropbox/Think Code Learn Ltd/Expenses/1. Not entered in Xero yet"
fi

echo "PDF extension is added for you."
date=`date +'%Y-%m-%d'`
read -e -p "Description: $date " DESCRIPTION
read -e -p "Cost: " COST
fullpath=$path"/$date $DESCRIPTION $COST.pdf"
phantomjs ~/.mutt/rasterize.js $newfile "$fullpath"
