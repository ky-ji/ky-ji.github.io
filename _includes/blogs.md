<h2 id="blogs" style="margin: 2px 0px -15px;"><a href="./blogs/" style="color: inherit;">Blogs</a></h2>

<div class="publications">
<ol class="bibliography">

{% for link in site.data.blogs.main %}

<li>
<div class="pub-row">
  <div class="col-sm-3 abbr" style="position: relative;padding-right: 15px;padding-left: 15px;">
    {% if link.image %}
    <a href="{{ link.url }}">
      <img src="{{ link.image }}" class="teaser img-fluid z-depth-1" style="object-fit:contain;background:#f8fafd;" alt="{{ link.title }}">
    </a>
    {% if link.tag %}
    <abbr class="badge">{{ link.tag }}</abbr>
    {% endif %}
    {% endif %}
  </div>
  <div class="col-sm-9" style="position: relative;padding-right: 15px;padding-left: 20px;">
      <div class="title"><a href="{{ link.url }}">{{ link.title }}</a></div>
      <div class="author">{{ link.date }}</div>
      <div class="periodical"><em>{{ link.description }}</em></div>
    <div class="links">
      {% if link.url %}
      <a href="{{ link.url }}" class="btn btn-sm z-depth-0" role="button" style="font-size:12px;">Read (EN)</a>
      {% endif %}
      {% if link.url_zh %}
      <a href="{{ link.url_zh }}" class="btn btn-sm z-depth-0" role="button" style="font-size:12px;">中文版</a>
      {% endif %}
    </div>
  </div>
</div>
</li>
<br>

{% endfor %}

</ol>
</div>
