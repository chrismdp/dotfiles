#!/usr/bin/env ruby

require 'mail'

SENDMAIL = '/usr/local/bin/msmtp'

mail = Mail.new($stdin.read)

if mail.parts.map(&:filename).include?("html-markdown-alternative.html")
  new_mail = Mail.new
  new_mail.header = mail.header.to_s

  text = nil
  html = nil
  new_parts = []

  mail.parts.each do |part|
    if part.content_type =~ %r{^text/plain}
      text = part
    elsif part.filename == 'html-markdown-alternative.html'
      html = part
    elsif !part.filename.nil? && part.filename != ''
      new_parts << part
    end
  end

  bodypart = Mail::Part.new
  bodypart.text_part = text
  bodypart.html_part = html
  new_mail.add_part bodypart

  new_parts.each do |part|
    new_mail.attachments[part.filename] = part.decoded
  end
else
  new_mail = mail
end

File.open("/tmp/message.postrb.txt", 'wb') do |f|
  f.print new_mail.to_s
end

IO.popen("#{SENDMAIL} #{ARGV.join(' ')}", 'w+', :err => :out) do |f|
  f.puts new_mail.encoded.to_lf
  f.flush
end
