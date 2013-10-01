#!/usr/bin/env ruby

require 'kramdown'

text = File.read(ARGV[0])
body = text.split(/\n\n/m)[1..-1].join("\n\n")
body.gsub!(/^[\w\<\-\+][^\n]*\n+/) do |x|
  x =~ /\n{2}/ ? x : (x.strip!; x << "  \n")
end

html = Kramdown::Document.new(body).to_html

File.open("/tmp/html-markdown-alternative.html", "w") do |file|
  file.print File.read("#{File.dirname(__FILE__)}/text2mime-markdown-header.html")
  file.print html
  file.print File.read("#{File.dirname(__FILE__)}/text2mime-markdown-footer.html")
end
